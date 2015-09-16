/**
*   ADS Node Client
*
*   Description: This library implement the TWINCAT ads protocol for Node.js to communicate with a Beckhoff PLC
*	Author: Cyril Praz
*	Date: 10.10.2015	
*
*   Copyright (c) 2015 Cyrillius
*
*   Permission is hereby granted, free of charge, to any person obtaining a 
*   copy of this software and associated documentation files (the "Software"), 
*   to deal in the Software without restriction, including without limitation 
*   the rights to use, copy, modify, merge, publish, distribute, sublicense, 
*   and/or sell copies of the Software, and to permit persons to whom the 
*   Software is furnished to do so, subject to the following conditions:
*
*   The above copyright notice and this permission notice shall be included in 
*   all copies or substantial portions of the Software.
*
*   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR 
*   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
*   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE 
*   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
*   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, 
*   ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
*   DEALINGS IN THE SOFTWARE.
*/
var util = require('util');
var Emitter = require('events').EventEmitter;
var buf = require('buffer');
var bunyan = require('bunyan');
var net = require('net');

// Log Manager
var log = null;

/******************************************************************************************************************
* Client Class
*******************************************************************************************************************/
var Client = function(options){

	// Attributes
	this.host = 	options.host || '127.0.0.1';
	this.port =  options.port || 48898;
	this.amsTargetNetID = options.amsTargetNetID || '0.0.0.0.0.0';
	this.amsSourceNetID = options.amsSourceNetID || '0.0.0.0.0.0';
	this.amsPortSource = options.amsPortSource || 32905; 
	this.amsPortTarget = options.amsPortTarget || 801;
	this.keepAlive = options.keepAlive || false;
	this.autoConnect = options.autoConnect || false;
	this.verbose = options.verbose || false;
	this.socket = null;
	this.symbols = [];
	this.listeners = [];
	this.pendingTrans = new Buffer(100);
	console.log(options);

	//Initialize the log manager
	log = bunyan.createLogger({
		name: 'adsNodeCLient',
		streams: [
			{
				level: this.verbose ? 'debug' : 'info',
			    stream: process.stdout            // log to stdout
			},
			{
			    level: 'error',
			    path: 'log.txt'  // log to a file
			}
		]
	});
	// When there is an error throw the error and quit
	log.on('error', function (err, stream) {
    	throw new Error(err);
	});

	// Format ams net id to be used by a buffer
    this.amsTargetNetID = this.amsTargetNetID.split('.');
    for (var i=0; i<this.amsTargetNetID.length;i++)
    {
        this.amsTargetNetID[i] = parseInt(this.amsTargetNetID[i], 10);
    }
    if(this.amsTargetNetID.length != 6) log.error('Incorrect amsTargetNetID length');
  	this.amsSourceNetID = this.amsSourceNetID.split('.');
    for (var i=0; i<this.amsSourceNetID.length;i++)
    {
        this.amsSourceNetID[i] = parseInt(this.amsSourceNetID[i], 10);
    }
    if(this.amsSourceNetID.length != 6) log.error('Incorrect amsSourceNetID length');

	// Say that there is no pending transaction
	for(var i=0; i<this.pendingTrans.length;i++)
		this.pendingTrans[i]=false;

	this.pendingTrans[0]=true;

	// Initialize Event Emitter
	Emitter.call(this);
	this.setMaxListeners(100);

	// If autoconnect try to connect now 
	if (options.host !== null) this.open();
};


// Inherits from Event Emitter. 
util.inherits(Client, Emitter);

/******************************************************************************************************************
* Open the socket and bind socket events
* 
* @return Socket the socket used for the communciation
*******************************************************************************************************************/
Client.prototype.open = function (){

	this.socket = net.connect(
        this.port,
        this.host
    );
    // create a place where to put the data received
   	this.socket.dataStream = null;
   	// keep our object in scope
   	this.socket.client = this;
    this.socket.setKeepAlive(this.keepAlive);
    this.socket.setNoDelay(true);

    // Bind events
    this.socket.on('connect', this.onConnect);
    this.socket.on('data', this.onData);
    this.socket.once('end', this.onEnd);
    this.socket.once('close', this.onClose);
    this.socket.on('onError', this.onError);
    this.socket.on('onTimeout', this.onTimeout);

    // Get symbols when it's connected
    var client = this;
   	this.socket.on('connect', function(){
    	client.getSymbolsSize(function(size){
    		client.getSymbols(size,function(symbols){
    			log.debug("Symbol List:",symbols);
    			client.symbols = symbols;
    			// Now we are ready to execute the user commands
    			client.emit('connect');
    			// If keep alive is true send a readSate request to the server to maintain open the communication
    			if(client.keepAlive){
    				setInterval(function(){
    					client.readState(
    						function(response){log.info("ADS STATE",getAdsState(response.data.adsState));}
    					);
    				},3000);
    			}
    		});
    	});

    });

    return this.socket;
};

/******************************************************************************************************************
* Close the socket and remove event listener
*******************************************************************************************************************/
Client.prototype.close = function (){

	//remove listeners
    this.socket.removeListener('connect', this.onConnect);
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('end', this.onEnd);
    this.socket.removeListener('close', this.onClose);
    this.socket.removeListener('onError', this.onError);
    this.socket.removeListener('onTimeout', this.onTimeout);

    this.releaseSymHandles();
    this.socket.end();

};

/******************************************************************************************************************
* Read device information	
*******************************************************************************************************************/
Client.prototype.readDeviceInfo = function (cb){
	log.info("read device info");
	var h = {
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.READ_DEVICE_INFO		
	}

	var data =  this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('deviceInfoResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID){ 
			if(cb !== undefined) cb(data);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=false;
		}
	});

	// write the frame
	this.socket.write(frame);


	return h.invokeID;
};

/******************************************************************************************************************
* Read device information	
*******************************************************************************************************************/
Client.prototype.readState = function (cb){
	log.info("read state");
	var h = {
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.READ_STATE	
	}

	var data =  this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('readStateResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID){ 
			if(cb !== undefined) cb(response);
			client.adsState = response.data.adsState;
			client.deviceState = response.data.deviceState;
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=false;
		}
	});

	// write the frame
	this.socket.write(frame);


	return h.invokeID;
};


/******************************************************************************************************************
*	ADS read command
*******************************************************************************************************************/
Client.prototype.receive =
Client.prototype.read = function (options,cb){
	log.info("read value");
	var h ={
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.WRITE
	}; 
	h =  this.checkIndex(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('readResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			if(cb !== undefined) cb(response);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=false;
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*	ADS write command
*******************************************************************************************************************/
Client.prototype.send =
Client.prototype.write = function(options,cb){
	log.info("write value");
	var h ={
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.WRITE
	}; 
	h =  this.checkIndex(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('writeResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			if(cb !== undefined) cb(response);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=false;			
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*	ADS sumup read command
*******************************************************************************************************************/
Client.prototype.multiReceive =
Client.prototype.multiRead = function (options,cb){
	log.info("read multiple value");
	log.info("This function is not yet implemented, sorry");

};

/******************************************************************************************************************
*	ADS sumup write command
*******************************************************************************************************************/
Client.prototype.multiSend =
Client.prototype.multiWrite = function(){
	log.info("write multiple value");
	log.info("This function is not yet implemented, sorry");
};

/******************************************************************************************************************
*	ADS add device notification
*******************************************************************************************************************/
Client.prototype.subscribe = function (options, cb){
	log.info("start listening a value");
	// check if there is already a notifHandle for the value
	for(var i=0; i<this.listeners.length; i++){
		if(options.indexGroup === undefined && options.indexGroup === undefined && options.symname !== undefined){
				if(this.listeners[i].symname.toUpperCase() = options.symname.toUpperCase()){
					log.debug("This value is already listening");
					return null;
				}
		}
		else if(options.indexGroup !== undefined && options.indexGroup !== undefined ){
				if(this.listeners[i].symname.toUpperCase() = options.symname.toUpperCase()){
					log.debug("This value is already listening");
					return null;
				}		
		}
	}
	var h = {
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.ADD_NOTIFICATION,
		transmissionMode:  options.transmissionMode || NOTIFY_TYPE.ONCHANGE,
		maxDelay: options.maxDelay || 0,
		cycleTime: options.cycleTime || 10
	};
	var client = this;

	// Check if the symbol exist and add informations
	var hp = this.checkIndex(h);
	if(hp==null){
		//Failed to find the symbol try to get the handle
		this.getSymHandleByName(options.symname, function(symHandle){
			hp = {
				indexGroup: 0xF005,
				indexOffset: symHandle,
				invokeID: client.getInvokeID(),
				commandID: CMD_ID.ADD_NOTIFICATION,
				transmissionMode:  options.transmissionMode || NOTIFY_TYPE.ONCHANGE,
				bytelength: options.bytelength,
				maxDelay: options.maxDelay || 0,
				cycleTime: options.cycleTime || 10
			};
			var data = client.genDataFrame(hp);
			var frame = client.genTcpFrame(hp, data); 

			// add  callback to the listener
			client.once('addNotifResponse',function(response){

				if( response.amsHeader.invokeId  == hp.invokeID) {
					if(cb !== undefined) cb(response);	
					// Add the notification handle with info to the table
					client.listeners[response.data.notifHandle] = h;
					// We can release the invoke Id for another transaction
					client.pendingTrans[h.invokeID]=false;	
					log.debug("Notification Handler received",response.data.notifHandle);	
				}
			});
			log.info("Sending addNotifRequest",hp)
			// write the frame
			client.socket.write(frame);
		});
		return null
	}
	else{
		var data = this.genDataFrame(h);
		var frame = this.genTcpFrame(h, data); 

		// add  callback to the listener
		this.once('addNotifResponse',function(response){
			if( response.amsHeader.invokeId  == h.invokeID) {
				if(cb !== undefined) cb(response);	
				// Add the notification handle with info to the table
				client.listeners[response.data.notifHandle] = h;
				// We can release the invoke Id for another transaction
				client.pendingTrans[h.invokeID]=false;	
				log.debug("Notification Handler received",response.data.notifHandle);	
			}
		});

		// write the frame
		this.socket.write(frame);
		return hp.invokeID;
	}

};

/******************************************************************************************************************
*	ADS delete device notification
*******************************************************************************************************************/
Client.prototype.unsubscribe = function (){
	log.info("stop listening a value");
	var h = {
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.DEL_NOTIFICATION
	} 
	h =  this.checkIndex(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('deleteNotifResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			cb(response);
			// Remove the notification handle with info to the table
			client.listeners.splice(response.data.notifHandle,1);	
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=false;			
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;

};

/******************************************************************************************************************
*	ADS get uploaded symbols command
*******************************************************************************************************************/
Client.prototype.getSymbols = function (length,cb){
	log.info("Get symbol list");
	var h = {
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.READ,
        indexGroup: 0x0000F00B,
        indexOffset: 0x00000000,
        bytelength: length,
	};

	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	// add  callback to the listener
	this.once('readResponse',function(response){
		if(response.amsHeader.invokeId == h.invokeID){ 
            var symbols = [];
            var pos = 0;
            var result = response.data.value;
            while (pos < result.length) {
                var symbol = {};
                var readLength = result.readUInt32LE(pos);
                symbol.indexGroup = result.readUInt32LE(pos + 4);
                symbol.indexOffset = result.readUInt32LE(pos + 8);
                var nameLength = result.readUInt16LE(pos + 24) + 1;
                var typeLength = result.readUInt16LE(pos + 26) + 1;
                var commentLength = result.readUInt16LE(pos + 28) + 1;

                pos = pos + 30;

                var nameBuf = new Buffer(nameLength);
                result.copy(nameBuf, 0, pos, pos+nameLength);
                symbol.name = nameBuf.toString('utf8', 0, findStringEnd(nameBuf, 0));
                pos = pos+nameLength;

                var typeBuf = new Buffer(typeLength);
                result.copy(typeBuf, 0, pos, pos+typeLength);
                symbol.type = typeBuf.toString('utf8', 0, findStringEnd(typeBuf, 0));
                pos = pos+typeLength;

                var commentBuf = new Buffer(commentLength);
                result.copy(commentBuf, 0, pos, pos+commentLength);
                symbol.comment = commentBuf.toString('utf8', 0, findStringEnd(commentBuf, 0));
                pos = pos+commentLength;

                symbols.push(symbol);
            }

			cb(symbols);
		}
	});
	
	log.debug("sending getSymbols request");
	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*	ADS get symbols size command
*******************************************************************************************************************/
Client.prototype.getSymbolsSize = function (cb){
	log.info("Get symbol list size");
	var h = {
		invokeID: this.getInvokeID(),
		commandID: CMD_ID.READ,
        indexGroup: 0x0000F00F,
        indexOffset: 0x00000000,
        bytelength: 0x30,
	};

	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	// add  callback to the listener
	this.once('readResponse',function(response){
		var length = response.data.value.readInt32LE(4);
		if( response.amsHeader.invokeId == h.invokeID){ 
				cb(length);
				this.pendingTrans[h.invokeID] = false;
		}
	});

	log.debug("sending getSymbolSize request");
	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*  ADS get symbol handle by name
*******************************************************************************************************************/
Client.prototype.getSymHandleByName = function (symname,cb){
	log.info("Get handle by symbol name");
    var h = {
    	invokeID: this.getInvokeID(),
        indexGroup: 0x0000F003,
        indexOffset: 0x00000000,
        readLength: 4,
        value: symname,
        writeLength: symname.length,
        commandID: CMD_ID.READ_WRITE,
    };

	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data);     

	// add  callback to the listener
	this.once('readWriteResponse',function(response){
		if( response.amsHeader.invokeId == h.invokeID){ 
			var symhandle = response.data.value;
			cb(symhandle);
			this.pendingTrans[h.invokeID] = false;
		}
	});

	log.debug("sending getSymHandleByName request");
	// write the frame
	this.socket.write(frame);
	return h.invokeID;
};


/******************************************************************************************************************
* ON CONNECT EVENT
******************************************************************************************************************/
Client.prototype.onConnect = function (){
	log.info('The connection is now open');
	this.emit('connect');
	return true;
};

/******************************************************************************************************************
* ON  DATA EVENT
******************************************************************************************************************/
Client.prototype.onData = function (data){
	log.debug('Some data has been received', data);
	//Get data
	if (this.dataStream === null) {
        this.dataStream = data;
    } else {
        this.dataStream = Buffer.concat([this.dataStream, data]);
    }
    //Check if we have received all the header data   
    var headerSize = FRAME_SIZE.TCP_HEAD + FRAME_SIZE.AMS_HEAD;
    if (this.dataStream.length < headerSize) {
    	log.debug("The reception of the header is not complete")
    	return false;    
    }
    //Check if we have received all the data  
    var length = this.dataStream.readUInt32LE(26);
    if (this.dataStream.length < headerSize + length) {
    	log.debug("The reception of the data is not complete")
    	return false;           
    }
    //Check if we are the target
    var amsTargetNetID= [this.dataStream[6], this.dataStream[7], this.dataStream[8], this.dataStream[9], this.dataStream[10], this.dataStream[11]];
    if (amsTargetNetID.toString != this.client.amsSourceNetID.toString) {
    	log.debug("The packet received is not for us",amsTargetNetID,this.client.amsSourceNetID);
    	return false;           
    }

	var response = {}
	// Parse data from TCP Header
	var tcpHeader = this.dataStream.slice(0,FRAME_SIZE.TCP_HEAD);
	response.tcpHeader = {
		reserved: tcpHeader.readUInt16LE(0),
		length: tcpHeader.readUInt32LE(2)
	}
	// Parse data from AMS Header
	var amsHeader = this.dataStream.slice(FRAME_SIZE.TCP_HEAD,FRAME_SIZE.TCP_HEAD + FRAME_SIZE.AMS_HEAD);
	response.amsHeader = {
		amsTargetNetID: [amsHeader[0], amsHeader[1], amsHeader[2], amsHeader[3], amsHeader[4], amsHeader[5]],
		amsPortTarget: amsHeader.readUInt16LE(6),
		amsSourceNetID: [amsHeader[8], amsHeader[9], amsHeader[10], amsHeader[11], amsHeader[12], amsHeader[13]],
		amsPortSource: amsHeader.readUInt16LE(14),
		commandID: amsHeader.readUInt16LE(16),
		stateFlags: amsHeader.readUInt16LE(18),
		length: amsHeader.readUInt32LE(20),
		errorId: amsHeader.readUInt32LE(24),
		invokeId: amsHeader.readUInt32LE(28)
	}
	// Parse data from Data Frame
	var dataFrame = this.dataStream.slice(FRAME_SIZE.TCP_HEAD + FRAME_SIZE.AMS_HEAD);
	response.data={};
    switch (response.amsHeader.commandID) {
    	case CMD_ID.READ_DEVICE_INFO:
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			majorVersion: dataFrame[4],
    			minorVersion: dataFrame[5],
    			versionBuild: dataFrame.readUInt16LE(6),
    			deviceName: dataFrame.toString("utf8",8)
    		};
    		this.client.emit('deviceInfoResponse',response);

    		break;
    	case CMD_ID.READ_WRITE :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			length: dataFrame.readUInt32LE(4),
    		};
    		switch (response.data.length) {
    			case 1: response.data.value = dataFrame.readUInt8(8); 		break;
    			case 2: response.data.value = dataFrame.readUInt16LE(8); 	break;
    			case 4: response.data.value = dataFrame.readUInt32LE(8); 	break;
    			case 8: response.data.value = dataFrame.readDoubleLE(8); 	break;
    			default: response.data.value = dataFrame.slice(8);			break;
    		}
    		this.client.emit('readWriteResponse',response);
    		break;
    	case CMD_ID.READ :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			length: dataFrame.readUInt32LE(4),
    		};
    		switch (response.data.length) {
    			case 1: response.data.value = dataFrame.readUInt8(8); 		break;
    			case 2: response.data.value = dataFrame.readUInt16LE(8); 	break;
    			case 4: response.data.value = dataFrame.readUInt32LE(8); 	break;
    			case 8: response.data.value = dataFrame.readDoubleLE(8); 	break;
    			default: response.data.value = dataFrame.slice(8);			break;
    		}
    		this.client.emit('readResponse',response);
    		break;

    	case CMD_ID.DEL_NOTIFICATION :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('deleteNotifResponse',response);
    		break;

    	case CMD_ID.WRITE_CONTROL :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('writeControlResponse',response);
    		break;

    	case CMD_ID.WRITE :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('writeResponse',response);
    		break;

    	case CMD_ID.READ_STATE :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			adsState: dataFrame.readUInt16LE(4),
    			deviceState: dataFrame.readUInt16LE(6),
    		};
    		this.client.emit('readStateResponse',response);
    		break;

    	case CMD_ID.ADD_NOTIFICATION :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			notifHandle: dataFrame.readUInt32LE(4),
    		};
    		this.client.emit('addNotifResponse',response);
    		break;

    	case CMD_ID.NOTIFICATION :
    		response.data = {
     			length: dataFrame.readUInt32LE(0),
    			stampsSize: dataFrame.readUInt32LE(4),   			
    		}
    		var stampsFrame = dataFrame.slice(8);
    		var readedByte = 0;
    		response.data.stamps = [];
    		for(var i=0; i<response.data.stampsSize; i++){
    			response.data.stamps[i]={};
    			response.data.stamps[i].timeStamp = stampsFrame.readDoubleLE(readedByte);
    			readedByte += 8;
    			response.data.stamps[i].samplesSize = stampsFrame.readUInt32LE(8);
    			readedByte += 4;
    			response.data.stamps[i].samples = []
    			for(var j=0; j<response.data.stamps[i].samplesSize; j++){
    				response.data.stamps[i].samples[j] = {};
    				response.data.stamps[i].samples[j].notifHandle = stampsFrame.readUInt32LE(readedByte);
    				readedByte += 4; 
    				response.data.stamps[i].samples[j].sampleLength = stampsFrame.readUInt32LE(readedByte);
    				readedByte += 4; 
		    		switch (response.data.stamps[i].samples[j].sampleLength) {
		    			case 1: response.data.stamps[i].samples[j].value = stampsFrame.readUInt8(readedByte); 	break;
		    			case 2: response.data.stamps[i].samples[j].value = stampsFrame.readUInt16LE(readedByte); 	break;
		    			case 4: response.data.stamps[i].samples[j].value = stampsFrame.readUInt32LE(readedByte); 	break;
		    			case 8: response.data.stamps[i].samples[j].value = stampsFrame.readDoubleLE(readedByte); 	break;
		    			default: response.data.stamps[i].samples[j].value = stampsFrame.slice(readedByte, readedByte + response.data.stamps[i].samples[j].sampleLength);	break;
		    		}
		    		readedByte += response.data.stamps[i].samples[j].sampleLength; 
		    		// Get information from the notification handle
		    		var h = this.client.listeners[response.data.stamps[i].samples[j].notifHandle];
		   			log.debug("Notif Handler",response.data.stamps[i].samples[j]);
		   			if(h !== undefined){
			    		var m = {
			    			tcpHeader: response.tcpHeader,
			    			amsHeader: response.amsHeader,
			    			data: {
			    				notifHandle: response.data.stamps[i].samples[j].notifHandle,
				    			indexGroup: h.indexGroup,
				    			indexOffset: h.indexOffset,
				    			symname: h.symname,
				    			value: response.data.stamps[i].samples[j].value
			    			}
			    		};
			    		this.client.emit('valueChange',m);
			    	}
    			}
    		} 	

    		this.client.emit('newNotification',response);
    		break;    	

    	default :
    		log.error("The commandID received is not handled", response);
    		return false;
    		break;
    }

    if (response.amsHeader.errorId > 0)
    	log.error(getError(response.amsHeader.errorId),response);

    if (response.data.result !== undefined)
	    if (response.data.result > 0)
	    	log.error(getError(response.data.result),response);

    log.debug ("parsed response:", response);
    this.client.emit ("receive", response);
    // clear the dataStream
    this.dataStream = null;
    return true;  
};

/******************************************************************************************************************
* ON END EVENT HANDLE
******************************************************************************************************************/
Client.prototype.onEnd = function (){
	log.info('The other end close the socket');
	this.emit('end');
	return true;
};

/******************************************************************************************************************
* ON CLOSE EVENT HANDLE
******************************************************************************************************************/
Client.prototype.onClose = function (){
	log.info('The socket is closed');
	this.emit('close');
	return true;
};

/******************************************************************************************************************
* ON ERROR EVENT HANDLE
******************************************************************************************************************/
Client.prototype.onError = function (error){
	log.error('An error has happened \n'+ error);
	this.emit('error',error);
	return true;
};

/******************************************************************************************************************
* ON TIMEOUT EVENT HANDLE
******************************************************************************************************************/
Client.prototype.onTimeout = function (){
	log.info('The connection has timed out');
	this.emit('timeout');
	return true;
};

/******************************************************************************************************************
* Get invoke id
******************************************************************************************************************/
Client.prototype.getInvokeID = function (){	
	log.debug("Transaction in progress",this.pendingTrans);
	var enoughPlace = false;
	var id = null;	
	for (var i = 0; i< this.pendingTrans.length; i++){
		if(this.pendingTrans[i] == false && enoughPlace == false){
			id = i;
			enoughPlace = true;
			this.pendingTrans[i] = true;
		}
	}

	if (!enoughPlace){
		log.error('There is to much pending transaction')
	}
	log.debug("Current Transaction id",id);

	return id;
};

/******************************************************************************************************************
* Check Index
******************************************************************************************************************/
Client.prototype.checkIndex = function(o){
	// If we want to work with symbol name
	if(o.indexGroup === undefined && o.indexOffset === undefined && o.symname !== undefined){
		var symname = o.symname.toUpperCase();
		var index = null;
		// Look up for the symbol inside the symbol table
		for(var i=0; i<this.symbols.length; i++){
			if(this.symbols[i].name == symname) index = i ;
		}
		// If we find something we can set the handle
		if(index !== null){
			o.indexGroup = this.symbols[index].indexGroup;
			o.indexOffset = this.symbols[index].indexOffset;
			o.bytelength = ADS_TYPE[this.symbols[index].type];
		}
		// Else we throw an error
		else{
			log.warn("The symbol doesn't exist",o);
			return null;
		}
	}
	else if(o.indexGroup !== undefined && o.indexOffset !== undefined){
		var index = null;
		// Look up for the symbol inside the symbol table
		for(var i=0; i<this.symbols.length; i++){
			if(this.symbols[i].indexGroup == o.indexGroup && this.symbols[i].indexOffset == o.indexOffset) index = i ;
		}
		// If we find something we can set the handle
		if(index !== null){
			o.symname = this.symbols[index].name;
			if (o.bytelength === undefined) o.bytelength = ADS_TYPE[this.symbols[index].type];
		}
		// Else try to send
		else{
			log.debug("The symbol doesn't exist Try to send",o);
		}
	}
	else {
		//Error there is not enough information
		log.error("There is not enough information to send something",o);
	}

	return o;

};

/******************************************************************************************************************
* Generate Data Frame
******************************************************************************************************************/
Client.prototype.genDataFrame = function (h){
	// Start to generate the frame
	var dataFrame;
	var dataSize = h.bytelength || 0;

	switch (h.commandID){
		case CMD_ID.READ_DEVICE_INFO :
			dataFrame = new Buffer(0);
			break; 

		case CMD_ID.READ :
			dataFrame = new Buffer(FRAME_SIZE.INDEX_GRP + FRAME_SIZE.INDEX_OFFSET + FRAME_SIZE.LENGTH);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.bytelength,8);
			break;

		case CMD_ID.WRITE :
			dataFrame = new Buffer(FRAME_SIZE.INDEX_GRP + FRAME_SIZE.INDEX_OFFSET + FRAME_SIZE.LENGTH + dataSize);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.bytelength,8);
			// Write data into the buffer
	    	switch(h.bytelength) {
		        case 1: 	dataFrame.writeUInt8(h.value, 12); 										break;
		        case 2: 	dataFrame.writeUInt16(h.value, 12); 									break;
		        case 4: 	dataFrame.writeUInt32(h.value, 12);										break;
		        case 8: 	dataFrame.writeUInt64(h.value, 12);  									break;
		        default: 	dataFrame.write(h.value + "\0", 12, h.value.length, "utf8");  			break;
	    	}
			break;

		case CMD_ID.READ_STATE :
			dataFrame = new Buffer(0);			
			break; 

		case CMD_ID.WRITE_CONTROL :
			dataFrame = new Buffer(FRAME_SIZE.ADS_STATE + FRAME_SIZE.DEVICE_STATE + FRAME_SIZE.LENGTH);
			dataFrame.writeUInt16LE(h.adsState,0);
			dataFrame.writeUInt16LE(h.deviceState,2);
			// We can send data to add further information I just need to start or stop the PLC
			// Then I don't send more data
			dataFrame.writeUInt32LE(0x0000,4);	
			break; 

		case CMD_ID.ADD_NOTIFICATION :
			dataFrame = new Buffer(FRAME_SIZE.INDEX_GRP + FRAME_SIZE.INDEX_OFFSET + FRAME_SIZE.LENGTH + FRAME_SIZE.TRANSMOD + FRAME_SIZE.MAX_DELAY + FRAME_SIZE.CYCLE_TIME + FRAME_SIZE.NOTIF_RESERVED);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.bytelength,8);
			dataFrame.writeUInt32LE(h.transmissionMode,12);
			dataFrame.writeUInt32LE(h.maxDelay,16);
			dataFrame.writeUInt32LE(h.cycleTime,20);	
			dataFrame.writeDoubleLE(0,24);  //  -- reserved Bytes
			dataFrame.writeDoubleLE(0,32);		
			break; 

		case CMD_ID.DEL_NOTIFICATION :
			dataFrame = new Buffer(FRAME_SIZE.NOTIF_HANDLE);
			dataFrame.writeUInt32LE(h.notifHandle,0);
			break; 

		case CMD_ID.READ_WRITE :
			dataSize = h.writeLength;
			dataFrame = new Buffer(FRAME_SIZE.INDEX_GRP + FRAME_SIZE.INDEX_OFFSET + FRAME_SIZE.LENGTH + FRAME_SIZE.LENGTH + dataSize);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.readLength,8);
			dataFrame.writeUInt32LE(h.writeLength,12);
	    	switch(h.bytelength) {
		        case 1: 	dataFrame.writeUInt8(h.value, 16); 										break;
		        case 2: 	dataFrame.writeUInt16(h.value, 16); 									break;
		        case 4: 	dataFrame.writeUInt32(h.value, 16);										break;
		        case 8: 	dataFrame.writeUInt64(h.value, 16);  									break;
		        default: 	dataFrame.write(h.value + "\0", 16, h.value.length, "utf8");  			break;
	    	}	
			break; 
	}

	return dataFrame;
};

/******************************************************************************************************************
* Generate TCP Frame
******************************************************************************************************************/
Client.prototype.genTcpFrame = function(h,d){
	var   	dataSize 		= d.length;

	// Generate the tcp Header
	var tcpHeader = new Buffer(FRAME_SIZE.TCP_HEAD);
	tcpHeader[0] = 0x00;   									// -- 2 reserved Bytes
	tcpHeader[1] = 0x00;
	tcpHeader.writeUInt32LE(FRAME_SIZE.AMS_HEAD + dataSize, 2); 	// -- length of the data
	// Generate the AMS Header
	var amsHeader = new Buffer(FRAME_SIZE.AMS_HEAD);
	amsHeader[0] = this.amsTargetNetID[0]; 			// -- amsTargetNetID
	amsHeader[1] = this.amsTargetNetID[1];
	amsHeader[2] = this.amsTargetNetID[2];
	amsHeader[3] = this.amsTargetNetID[3];
	amsHeader[4] = this.amsTargetNetID[4];
	amsHeader[5] = this.amsTargetNetID[5];
	amsHeader.writeUInt16LE(this.amsPortTarget,6);		// -- amsPortTarget
	amsHeader[8] = this.amsSourceNetID[0];				// -- amsSourceNetID
	amsHeader[9] = this.amsSourceNetID[1];
	amsHeader[10] = this.amsSourceNetID[2];
	amsHeader[11] = this.amsSourceNetID[3];
	amsHeader[12] = this.amsSourceNetID[4];
	amsHeader[13] = this.amsSourceNetID[5];
	amsHeader.writeUInt16LE(this.amsPortSource,14);	// -- amsPortSource
	amsHeader.writeUInt16LE(h.commandID,16);		// -- commandID
	amsHeader.writeUInt16LE(4,18);					// -- request state flags
	amsHeader.writeUInt32LE(dataSize,20);			// -- Data length
	amsHeader.writeUInt32LE(0,24);					// -- Error code
	amsHeader.writeUInt32LE(h.invokeID,28);			// -- InvokeID

	// Generate the fram
	var frame = new Buffer(FRAME_SIZE.TCP_HEAD + FRAME_SIZE.AMS_HEAD + dataSize);
	tcpHeader.copy(frame, 0, 0);
	amsHeader.copy(frame, FRAME_SIZE.TCP_HEAD);
	d.copy(frame, FRAME_SIZE.TCP_HEAD + FRAME_SIZE.AMS_HEAD);

	return frame;
};

/******************************************************************************************************************
* HELPERS and CONSTANTS
******************************************************************************************************************/

/** 
* FRAME SIZE
*/
const FRAME_SIZE = {
	TCP_HEAD: 6,
	AMS_HEAD: 32,
	INDEX_GRP: 4,
	INDEX_OFFSET: 4,
	LENGTH: 4,
	ADS_STATE: 2,
	DEVICE_STATE: 2,
	TRANSMOD: 4,
	MAX_DELAY: 4,
	CYCLE_TIME: 4,
	NOTIF_RESERVED: 16,
	NOTIF_HANDLE: 4	
}


/**
* COMMAND ID
*/
const CMD_ID = {
	READ_DEVICE_INFO: 1,
	READ: 2,
	WRITE: 3,
	READ_STATE: 4,
	WRITE_CONTROL: 5,
	ADD_NOTIFICATION: 6,
	DEL_NOTIFICATION: 7,
	NOTIFICATION: 8,
	READ_WRITE: 9,
}
/**
* ADS TYPE
*/
const ADS_TYPE = {
	BOOL			: 1,
    BYTE 			: 1,
    WORD 			: 2,
    DWORD 			: 4,
    SINT 			: 1,
    USINT 			: 1,
    INT 			: 2,
    UINT 			: 2,
    DINT 			: 4,
    UDINT 			: 4,
    LINT 			: 8,
    ULINT 			: 8,
    REAL 			: 4,
    LREAL 			: 8,
    TIME 			: 4,
    TIME_OF_DAY		: 4,
    DATE 			: 4,
    DATE_AND_TIME	: 4,
    STRING			: 81
}


/** 
* NOTIFY_TYPE
*/
const NOTIFY_TYPE = {
    CYCLIC: 3,
    ONCHANGE: 4
};


/**
* ADS STATE
*/
const ADS_STATE = { 
	INVALID     	: 0,
	IDLE          	: 1,
	RESET         	: 2,
	INIT          	: 3,
	START         	: 4,
	RUN           	: 5,
	STOP          	: 6,
	SAVECFG       	: 7,
	LOADCFG       	: 8,
	POWERFAILURE  	: 9,
	POWERGOOD     	: 10,
	ERROR         	: 11,
	SHUTDOWN      	: 12,
	SUSPEND  		: 13,
	RESUME        	: 14,
	CONFIG        	: 15, // system is in config mode
	RECONFIG      	: 16
};
var getAdsState = function (state){
	var s = "";
	switch (state){
		case ADS_STATE.INVALID:
			s = "Invalid"; 
			break;
		case ADS_STATE.IDLE:
			s = "Idle"; 
			break;
		case ADS_STATE.RESET:
			s = "Reset"; 
			break;
		case ADS_STATE.INIT:
			s = "Init"; 
			break;
		case ADS_STATE.START:
			s = "Start"; 
		 	break;
		case ADS_STATE.RUN:
			s = "Run"; 
			break;
		case ADS_STATE.STOP:
			s = "Stop"; 
			break;
		case ADS_STATE.SAVECFG:
			s = "Save Config"; 
			break;
		case ADS_STATE.LOADCFG:
			s = "Load Config"; 
			break;
		case ADS_STATE.POWERFAILURE:
			s = "Power Failure"; 
			break;
		case ADS_STATE.POWERGOOD:
			s = "Power Good"; 
			break;
		case ADS_STATE.ERROR:
			s = "Error"; 
			break;
		case ADS_STATE.SHUTDOWN:
			s = "Shutdown"; 
			break;
		case ADS_STATE.SUSPEND:
			s = "Suspend"; 
			break;
		case ADS_STATE.RESUME:
			s = "Resume"; 
			break;
		case ADS_STATE.CONFIG:
			s = "Config"; 
			break;
		case ADS_STATE.RECONFIG:
			s = "Reconfig"; 
			break;
		default :
			s = "Unknow";
			break;
	}
	return s;
}

/**
*	ADS Services
*/
const ADS_SERVICES = {
	SYMTAB				: 0xF000,
	SYMNAME				: 0xF001,
	SYMVAL				: 0xF002,
	SYM_HNDBYNAME		: 0xF003,
	SYM_VALBYNAME		: 0xF004,
	SYM_VALBYHND		: 0xF005,
	SYM_RELEASEHND		: 0xF006,
	SYM_INFOBYNAME		: 0xF007,
	SYM_VERSION			: 0xF008,
	SYM_INFOBYNAMEEX	: 0xF009,
	SYM_DOWNLOAD		: 0xF00A,
	SYM_UPLOAD			: 0xF00B,
	SYM_UPLOADINFO		: 0xF00C,
	SYMNOTE				: 0xF010,
	IOIMAGE_RWIB		: 0xF020,
	IOIMAGE_RWIX		: 0xF021,
	IOIMAGE_RISIZE		: 0xF025,
	IOIMAGE_RWOB		: 0xF030,
	IOIMAGE_RWOX		: 0xF031,
	IOIMAGE_RWOSIZE		: 0xF035,
	IOIMAGE_CLEARI		: 0xF040,
	IOIMAGE_CLEARO		: 0xF050,
	IOIMAGE_RWIOB		: 0xF060,
	DEVICE_DATA			: 0xF100,
	DEVDATA_ADSSTATE	: 0x0000,
	DEVDATA_DEVSTATE	: 0x0002
};

var findStringEnd = function(data, offset) {
    if (!offset) { offset = 0; }
    var endpos = offset;
    for (var i=offset; i<data.length; i++)
    {
        if (data[i] === 0x00) {
            endpos = i;
            break;
        }
    }
    return endpos;
};


var getError = function(errorId) {
    var msg = "";
    switch(errorId) {
        case 1 : msg = "Internal error"; break;
        case 2 : msg = "No Rtime"; break;
        case 3 : msg = "Allocation locked memory error"; break;
        case 4 : msg = "Insert mailbox error"; break;
        case 5 : msg = "Wrong receive HMSG"; break;
        case 6 : msg = "target port not found"; break;
        case 7 : msg = "target machine not found"; break;
        case 8 : msg = "Unknown command ID"; break;
        case 9 : msg = "Bad task ID"; break;
        case 10: msg = "No IO"; break;
        case 11: msg = "Unknown AMS command"; break;
        case 12: msg = "Win 32 error"; break;
        case 13: msg = "Port not connected"; break;
        case 14: msg = "Invalid AMS length"; break;
        case 15: msg = "Invalid AMS Net ID"; break;
        case 16: msg = "Low Installation level"; break;
        case 17: msg = "No debug available"; break;
        case 18: msg = "Port disabled"; break;
        case 19: msg = "Port already connected"; break;
        case 20: msg = "AMS Sync Win32 error"; break;
        case 21: msg = "AMS Sync Timeout"; break;
        case 22: msg = "AMS Sync AMS error"; break;
        case 23: msg = "AMS Sync no index map"; break;
        case 24: msg = "Invalid AMS port"; break;
        case 25: msg = "No memory"; break;
        case 26: msg = "TCP send error"; break;
        case 27: msg = "Host unreachable"; break;
                   
        case 1792: msg="error class <device error>"; break;
        case 1793: msg="Service is not supported by server"; break;
        case 1794: msg="invalid index group"; break;
        case 1795: msg="invalid index offset"; break;
        case 1796: msg="reading/writing not permitted"; break;
        case 1797: msg="parameter size not correct"; break;
        case 1798: msg="invalid parameter value(s)"; break;
        case 1799: msg="device is not in a ready state"; break;
        case 1800: msg="device is busy"; break;
        case 1801: msg="invalid context (must be in Windows)"; break;
        case 1802: msg="out of memory"; break;
        case 1803: msg="invalid parameter value(s)"; break;
        case 1804: msg="not found (files, ...)"; break;
        case 1805: msg="syntax error in command or file"; break;
        case 1806: msg="objects do not match"; break;
        case 1807: msg="object already exists"; break;
        case 1808: msg="symbol not found"; break;
        case 1809: msg="symbol version invalid"; break;
        case 1810: msg="server is in invalid state"; break;
        case 1811: msg="AdsTransMode not supported"; break;
        case 1812: msg="Notification handle is invalid"; break;
        case 1813: msg="Notification client not registered"; break;
        case 1814: msg="no more notification handles"; break;
        case 1815: msg="size for watch too big"; break;
        case 1816: msg="device not initialized"; break;
        case 1817: msg="device has a timeout"; break;
        case 1818: msg="query interface failed"; break;
        case 1819: msg="wrong interface required"; break;
        case 1820: msg="class ID is invalid"; break;
        case 1821: msg="object ID is invalid"; break;
        case 1822: msg="request is pending"; break;
        case 1823: msg="request is aborted"; break;
        case 1824: msg="signal warning"; break;
        case 1825: msg="invalid array index"; break;
        case 1826: msg="symbol not active -> release handle and try again"; break;
        case 1827: msg="access denied"; break;
        case 1856: msg="Error class <client error>"; break;
        case 1857: msg="invalid parameter at service"; break;
        case 1858: msg="polling list is empty"; break;
        case 1859: msg="var connection already in use"; break;
        case 1860: msg="invoke ID in use"; break;
        case 1861: msg="timeout elapsed"; break;
        case 1862: msg="error in win32 subsystem"; break;
        case 1863: msg="Invalid client timeout value"; break;
        case 1864: msg="ads-port not opened"; break;
        case 1872: msg="internal error in ads sync"; break;
        case 1873: msg="hash table overflow"; break;
        case 1874: msg="key not found in hash"; break;
        case 1875: msg="no more symbols in cache"; break;
        case 1876: msg="invalid response received"; break;
        case 1877: msg="sync port is locked"; break;
    }
    return msg;
};

/**
 * Module exports.
 */

module.exports = exports = Client;

















