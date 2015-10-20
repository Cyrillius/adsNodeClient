/**
*   ADS Node Client
*
*   Description: This library implement the TWINCAT ads protocol for Node.js to communicate with a Beckhoff PLC
*	Author: Cyril Praz
*	Date: 10.10.2015	
*
*   Copyright (c) 2015 Cyril Praz
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
var log = {
	info: require('debug')('adsNodeClient:info'),
	debug: null
};
var net = require('net');
var adsProtocol = require('./adsProtocol')


/******************************************************************************************************************
* Client Class
*******************************************************************************************************************/
var AdsClient = function(options){

	// default attributes
	this.host = 			'127.0.0.1';
	this.port = 			48898;
	this.amsTargetNetID = 	'0.0.0.0.0.0';
	this.amsSourceNetID = 	'0.0.0.0.0.0';
	this.amsPortSource = 	32905; 
	this.amsPortTarget = 	801;
	this.keepAlive = 		false;
	this.autoConnect = 		false;
	this.verbose = 			false;
	this.socket = 			null;
	this.symbols = 			[];
	this.listeners = 		[];
	this.pendingTrans = 	[];
	this.maxPendingTrans = 	20;

	// instancied attributes
	if(options !== undefined){
		if(options.host !== undefined) 				this.host =  options.host;
		if(options.port !== undefined) 				this.port =  options.port;
		if(options.amsTargetNetID !== undefined)	this.amsTargetNetID =  options.amsTargetNetID;
		if(options.amsSourceNetID !== undefined)	this.amsSourceNetID =  options.amsSourceNetID;
		if(options.amsPortSource !== undefined) 	this.amsPortSource =  options.amsPortSource;
		if(options.amsPortTarget !== undefined) 	this.amsPortTarget =  options.amsPortTarget;
		if(options.keepAlive !== undefined) 		this.keepAlive =  options.keepAlive;
		if(options.autoConnect !== undefined) 		this.autoConnect =  options.autoConnect;
		if(options.verbose !== undefined) 			this.verbose =  options.verbose;	
	}

	// Format ams net id to be used by a buffer
    this.amsTargetNetID = this.amsTargetNetID.split('.');
    for (var i=0; i<this.amsTargetNetID.length;i++)
    {
        this.amsTargetNetID[i] = parseInt(this.amsTargetNetID[i], 10);
    }   
    if(this.amsTargetNetID.length != 6) throw new Error('Incorrect amsTargetNetID length');

  	this.amsSourceNetID = this.amsSourceNetID.split('.');
    for (var i=0; i<this.amsSourceNetID.length;i++)
    {
        this.amsSourceNetID[i] = parseInt(this.amsSourceNetID[i], 10);
    }
    if(this.amsSourceNetID.length != 6) throw new Error('Incorrect amsSourceNetID length');

	// Initialize Event Emitter
	Emitter.call(this);
	this.setMaxListeners(30);

	// If autoconnect try to connect now 
	if (this.autoConnect == true) this.open();

	// If verbose create debug
	if (this.verbose == true) log.debug = require('debug')('adsNodeClient:debug');
};


// Inherits from Event Emitter. 
util.inherits(AdsClient, Emitter);

/******************************************************************************************************************
* Open the socket and bind socket events
* 
* @return Socket the socket used for the communciation
*******************************************************************************************************************/
AdsClient.prototype.open = function (){

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
*
* @return Boolean true
*******************************************************************************************************************/
AdsClient.prototype.close = function (){

	//remove listeners
    this.socket.removeListener('connect', this.onConnect);
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('end', this.onEnd);
    this.socket.removeListener('close', this.onClose);
    this.socket.removeListener('onError', this.onError);
    this.socket.removeListener('onTimeout', this.onTimeout);

    this.releaseSymHandles();
    this.socket.end();

    return true;
};

/******************************************************************************************************************
* Read device information	
* 
* @param cb Function callback executed when the answer is received
* @return INT the id of the transaction
*******************************************************************************************************************/
AdsClient.prototype.readDeviceInfo = function (cb){
	log.info("read device info");
	var h = {
		commandID: adsProtocol.cmd_id["READ_DEVICE_INFO"]		
	}

	h.invokeID = this.regTransaction(h);
	var data =  this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('deviceInfoResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID){ 
			if(cb !== undefined) cb(data);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=null;
		}
	});

	// write the frame
	this.socket.write(frame);


	return h.invokeID;
};

/******************************************************************************************************************
* Read device information	
*
* @param cb Function callabck executed when the answer is received
* @return INT the id of the transaction
*******************************************************************************************************************/
AdsClient.prototype.readState = function (cb){
	log.info("read state");
	var h = {
		commandID: adsProtocol.cmd_id["READ_STATE"]		
	};

	h.invokeID = this.regTransaction(h);
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
			client.pendingTrans[h.invokeID]=null;
		}
	});

	// write the frame
	this.socket.write(frame);


	return h.invokeID;
};


/******************************************************************************************************************
*	ADS read command
*******************************************************************************************************************/
AdsClient.prototype.receive =
AdsClient.prototype.read = function (options,cb){
	log.info("read value");
	var h ={
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		commandID: adsProtocol.cmd_id["WRITE"]	
	}; 

	h =  this.checkIndex(h);

	h.invokeID = this.regTransaction(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('readResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			if(cb !== undefined) cb(response);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=null;
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*	ADS write command
*******************************************************************************************************************/
AdsClient.prototype.send =
AdsClient.prototype.write = function(options,cb){
	log.info("write value");
	var h ={
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		commandID: adsProtocol.cmd_id["WRITE"],
		value: options.value
	}; 
	h =  this.checkIndex(h);

	h.invokeID = this.regTransaction(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.once('writeResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			if(cb !== undefined) cb(response);
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=null;			
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;
};

/******************************************************************************************************************
*	ADS sumup read command
*******************************************************************************************************************/
AdsClient.prototype.multiReceive =
AdsClient.prototype.multiRead = function (options,cb){
	log.info("read multiple value");
	log.info("This function is not yet implemented, sorry");

};

/******************************************************************************************************************
*	ADS sumup write command
*******************************************************************************************************************/
AdsClient.prototype.multiSend =
AdsClient.prototype.multiWrite = function(){
	log.info("write multiple value");
	log.info("This function is not yet implemented, sorry");
};

/******************************************************************************************************************
*	ADS add device notification
*******************************************************************************************************************/
AdsClient.prototype.subscribe = function (options, cb){
	log.info("start listening a value");
	// check if there is already a notifHandle for the value
	for(var i=0; i<this.listeners.length; i++){
		if(options.indexGroup === undefined && options.indexGroup === undefined && options.symname !== undefined){
				if(this.listeners[i] !== undefined){
					if(this.listeners[i].symname.toUpperCase() == options.symname.toUpperCase()){
						log.debug("This value is already listening");
						return null;
					}
				}
		}
		else if(options.indexGroup !== undefined && options.indexGroup !== undefined ){
			if(this.listeners[i] !== undefined){
				if(this.listeners[i].symname.toUpperCase() == options.symname.toUpperCase()){
					log.debug("This value is already listening");
					return null;
				}		
			}
		}
	}
	var h = {
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		type:options.type,
		commandID: adsProtocol.cmd_id["ADD_NOTIFICATION"],
		transmissionMode:  options.transmissionMode || adsProtocol.notify["ONCHANGE"],
		maxDelay: options.maxDelay || 0,
		cycleTime: options.cycleTime || 10
	};
	log.debug("BOUH",h);
	var client = this;

	// Check if the symbol exist and add informations
	var hp = this.checkIndex(h);
	if(hp==null){
		//Failed to find the symbol try to get the handle
		this.getSymHandleByName(options.symname, function(symHandle){
			hp = {
				indexGroup: 0xF005,
				indexOffset: symHandle,
				commandID: adsProtocol.cmd_id["ADD_NOTIFICATION"],
				transmissionMode:  options.transmissionMode || adsProtocol.notify["ONCHANGE"],
				type: options.type,
				maxDelay: options.maxDelay || 0,
				cycleTime: options.cycleTime || 10
			};
			hp.invokeID = client.regTransaction(hp);
			var data = client.genDataFrame(hp);
			var frame = client.genTcpFrame(hp, data); 

			// add  callback to the listener
			client.once('addNotifResponse',function(response){

				if( response.amsHeader.invokeId  == hp.invokeID) {
					if(cb !== undefined) cb(response);	
					// Add the notification handle with info to the table
					client.listeners[response.data.notifHandle] = h;
					// We can release the invoke Id for another transaction
					client.pendingTrans[h.invokeID]=null;	
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
		h.invokeID = this.regTransaction(h);
		var data = this.genDataFrame(h);
		var frame = this.genTcpFrame(h, data); 

		// add  callback to the listener
		this.once('addNotifResponse',function(response){
			if( response.amsHeader.invokeId  == h.invokeID) {
				if(cb !== undefined) cb(response);	
				// Add the notification handle with info to the table
				client.listeners[response.data.notifHandle] = h;
				// We can release the invoke Id for another transaction
				client.pendingTrans[h.invokeID]=null;	
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
AdsClient.prototype.unsubscribe = function (){
	log.info("stop listening a value");
	var h = {
		indexGroup: options.indexGroup,
		indexOffset: options.indexOffset,
		symname: options.symname,
		commandID: adsProtocol.cmd_id["DEL_NOTIFICATION"]
	} 
	h =  this.checkIndex(h);

	h.invokeID = this.regTransaction(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	var client = this;
	// add  callback to the listener
	this.on('deleteNotifResponse',function(response){
		if( response.amsHeader.invokeId  == h.invokeID) {
			cb(response);
			// Remove the notification handle with info to the table
			client.listeners.splice(response.data.notifHandle,1);	
			// We can release the invoke Id for another transaction
			client.pendingTrans[h.invokeID]=null;			
		}
	});

	// write the frame
	this.socket.write(frame);

	return h.invokeID;

};

/******************************************************************************************************************
*	ADS get uploaded symbols command
*******************************************************************************************************************/
AdsClient.prototype.getSymbols = function (length,cb){
	log.info("Get symbol list");
	var h = {
		commandID: adsProtocol.cmd_id["READ"],
        indexGroup: 0x0000F00B,
        indexOffset: 0x00000000,
        bytelength: length,
        type: "BUFFER"
	};

	h.invokeID = this.regTransaction(h);
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
AdsClient.prototype.getSymbolsSize = function (cb){
	log.info("Get symbol list size");
	var h = {
		commandID: adsProtocol.cmd_id["READ"],
        indexGroup: 0x0000F00F,
        indexOffset: 0x00000000,
        bytelength: 0x30,
        type:"BUFFER"
	};
	h =  this.checkIndex(h);

	h.invokeID = this.regTransaction(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data); 

	// add  callback to the listener
	this.once('readResponse',function(response){
		var length = response.data.value.readInt32LE(4);
		if( response.amsHeader.invokeId == h.invokeID){ 
				cb(length);
				this.pendingTrans[h.invokeID] = null;
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
AdsClient.prototype.getSymHandleByName = function (symname,cb){
	log.info("Get handle by symbol name");
    var h = {
        indexGroup: 0x0000F003,
        indexOffset: 0x00000000,
        readLength: 4,
        value: symname,
        writeLength: symname.length,
        commandID: adsProtocol.cmd_id["READ_WRITE"],
        writeType: "BUFFER",
        type: "DWORD"
    };

    h.invokeID = this.regTransaction(h);
	var data = this.genDataFrame(h);
	var frame = this.genTcpFrame(h, data);     

	// add  callback to the listener
	this.once('readWriteResponse',function(response){
		if( response.amsHeader.invokeId == h.invokeID){ 
			var symhandle = response.data.value;
			cb(symhandle);
			this.pendingTrans[h.invokeID] = null;
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
AdsClient.prototype.onConnect = function (){
	log.info('The connection is now open');
	return true;
};

/******************************************************************************************************************
* ON  DATA EVENT
******************************************************************************************************************/
AdsClient.prototype.onData = function (data){
	log.debug('Some data has been received', data);
	//Get data
	if (this.dataStream === null) {
        this.dataStream = data;
    } else {
        this.dataStream = Buffer.concat([this.dataStream, data]);
    }
    //Check if we have received all the header data   
    var headerSize = adsProtocol.frames["TCP_HEAD"].size  + adsProtocol.frames["AMS_HEAD"].size ;
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
	var tcpHeader = this.dataStream.slice(0,adsProtocol.frames["TCP_HEAD"].size );
	response.tcpHeader = {
		reserved: tcpHeader.readUInt16LE(0),
		length: tcpHeader.readUInt32LE(2)
	}
	// Parse data from AMS Header
	var amsHeader = this.dataStream.slice(adsProtocol.frames["TCP_HEAD"].size ,adsProtocol.frames["TCP_HEAD"].size  + adsProtocol.frames["AMS_HEAD"].size );
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
	var dataFrame = this.dataStream.slice(	adsProtocol.frames["TCP_HEAD"].size  + adsProtocol.frames["AMS_HEAD"].size );
	response.data={};
    switch (response.amsHeader.commandID) {
    	case adsProtocol.cmd_id["READ_DEVICE_INFO"]:
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			majorVersion: dataFrame[4],
    			minorVersion: dataFrame[5],
    			versionBuild: dataFrame.readUInt16LE(6),
    			deviceName: dataFrame.toString("utf8",8)
    		};
    		this.client.emit('deviceInfoResponse',response);

    		break;
    	case adsProtocol.cmd_id["READ_WRITE"] :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			length: dataFrame.readUInt32LE(4),
    		};
    		var id = response.amsHeader.invokeId;
    		if (this.client.pendingTrans[id] === undefined || this.client.pendingTrans[id] === null){
    			log.warn("received a foreign transaction", response);
    			return false;
    		}
    		var type = this.client.pendingTrans[id].handle.type;
    		switch (adsProtocol.types[type].bufferType) {
    			case "uint8": 		response.data.value = dataFrame.readUInt8(8); 				break;
		        case "int8": 		response.data.value = dataFrame.readInt8(8); 				break;
		        case "uint16LE": 	response.data.value = dataFrame.readUInt16LE(8); 			break;
		        case "int16LE": 	response.data.value = dataFrame.readInt16LE(8); 			break;
		        case "uint32LE": 	response.data.value = dataFrame.readUInt32LE(8);			break;
		        case "int32LE": 	response.data.value = dataFrame.readInt32LE(8);				break;
		        case "floatLE": 	response.data.value = dataFrame.readFloatLE(8);  			break;
		        case "doubleLE": 	response.data.value = dataFrame.readDoubleLE(8);  			break;
    			default: response.data.value = dataFrame.slice(8);			break;
    		}
    		this.client.emit('readWriteResponse',response);
    		break;
    	case adsProtocol.cmd_id["READ"] :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			length: dataFrame.readUInt32LE(4),
    		};
    		var id = response.amsHeader.invokeId;
    		if (this.client.pendingTrans[id] === undefined || this.client.pendingTrans[id] === null){
    			log.warn("received a foreign transaction", response);
    			return false;
    		}
    		var type = this.client.pendingTrans[id].handle.type;
    		if (type !== undefined){
    			type = adsProtocol.types[type].bufferType;
    		}
    		switch (type) {
    			case "uint8": 		response.data.value = dataFrame.readUInt8(8); 				break;
		        case "int8": 		response.data.value = dataFrame.readInt8(8); 				break;
		        case "uint16LE": 	response.data.value = dataFrame.readUInt16LE(8); 			break;
		        case "int16LE": 	response.data.value = dataFrame.readInt16LE(8); 			break;
		        case "uint32LE": 	response.data.value = dataFrame.readUInt32LE(8);			break;
		        case "int32LE": 	response.data.value = dataFrame.readInt32LE(8);				break;
		        case "floatLE": 	response.data.value = dataFrame.readFloatLE(8);  			break;
		        case "doubleLE": 	response.data.value = dataFrame.readDoubleLE(8);  			break;
    			default: response.data.value = dataFrame.slice(8);								break;
    		}
    		this.client.emit('readResponse',response);
    		break;

    	case adsProtocol.cmd_id["DEL_NOTIFICATION"] :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('deleteNotifResponse',response);
    		break;

    	case adsProtocol.cmd_id["WRITE_CONTROL"] :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('writeControlResponse',response);
    		break;

    	case adsProtocol.cmd_id["WRITE"] :
    		response.data.result= dataFrame.readUInt32LE(0);
    		this.client.emit('writeResponse',response);
    		break;

    	case adsProtocol.cmd_id["READ_STATE"] :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			adsState: dataFrame.readUInt16LE(4),
    			deviceState: dataFrame.readUInt16LE(6),
    		};
    		this.client.emit('readStateResponse',response);
    		break;

    	case adsProtocol.cmd_id["ADD_NOTIFICATION"] :
    		response.data = {
    			result: dataFrame.readUInt32LE(0),
    			notifHandle: dataFrame.readUInt32LE(4),
    		};
    		this.client.emit('addNotifResponse',response);
    		break;

    	case adsProtocol.cmd_id["NOTIFICATION"] :
    		log.debug("Notification received");
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
    				// Get information from the notification handle
    				var h = this.client.listeners[response.data.stamps[i].samples[j].notifHandle];
    				if(h !== undefined){
			    		var m = {
			    			tcpHeader: response.tcpHeader,
			    			amsHeader: response.amsHeader,
			    			data: {
			    				notifHandle: response.data.stamps[i].samples[j].notifHandle,
				    			indexGroup: h.indexGroup,
				    			indexOffset: h.indexOffset,
				    			symname: h.symname,
				    			timestamp: response.data.stamps[i].timeStamp 
			    			}
			    		};
			    		log.debug("value change",m);
			    		this.client.emit('valueChange',m);
			    	
			    		switch (adsProtocol.types[h.type].bufferType) {
			    			case "uint8": 		m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readUInt8(readedByte); 				break;
					        case "int8": 		m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readInt8(readedByte); 				break;
					        case "uint16LE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readUInt16LE(readedByte); 			break;
					        case "int16LE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readInt16LE(readedByte); 			break;
					        case "uint32LE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readUInt32LE(readedByte);			break;
					        case "int32LE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readInt32LE(readedByte);				break;
					        case "floatLE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readFloatLE(readedByte);  			break;
					        case "doubleLE": 	m.data.value = response.data.stamps[i].samples[j].value = stampsFrame.readDoubleLE(readedByte);  			break;
			    			default: response.data.stamps[i].samples[j].value = stampsFrame.slice(readedByte, readedByte + response.data.stamps[i].samples[j].sampleLength);	break;
			    		}
			    	}
		    		readedByte += response.data.stamps[i].samples[j].sampleLength;   		
    			}
    		} 	

    		this.client.emit('newNotification',response);
    		break;    	

    	default :
    		throw new Error("The commandID received is not handled", response);
    		return false;
    		break;
    }

    if (response.amsHeader.errorId > 0)
    	throw new Error(getError(response.amsHeader.errorId),response);

    if (response.data.result !== undefined)
	    if (response.data.result > 0)
	    	throw new Error(getError(response.data.result),response);

    log.debug ("parsed response:", response);
    this.client.emit ("receive", response);
    // clear the dataStream
    this.dataStream = null;
    return true;  
};

/******************************************************************************************************************
* ON END EVENT HANDLE
******************************************************************************************************************/
AdsClient.prototype.onEnd = function (){
	log.info('The other end close the socket');
	this.emit('end');
	return true;
};

/******************************************************************************************************************
* ON CLOSE EVENT HANDLE
******************************************************************************************************************/
AdsClient.prototype.onClose = function (){
	log.info('The socket is closed');
	this.emit('close');
	return true;
};

/******************************************************************************************************************
* ON ERROR EVENT HANDLE
******************************************************************************************************************/
AdsClient.prototype.onError = function (error){
	throw new Error('An error has happened \n'+ error);
	this.emit('error',error);
	return true;
};

/******************************************************************************************************************
* ON TIMEOUT EVENT HANDLE
******************************************************************************************************************/
AdsClient.prototype.onTimeout = function (){
	log.info('The connection has timed out');
	this.emit('timeout');
	return true;
};

/******************************************************************************************************************
* Get invoke id
******************************************************************************************************************/
AdsClient.prototype.regTransaction = function (h){	
	var enoughPlace = false;
	var id = null;	
	for (var i = 0; i< this.maxPendingTrans; i++){
		if((this.pendingTrans[i] === undefined || this.pendingTrans[i] === null) && enoughPlace == false){
			id = i;
			enoughPlace = true;

			this.pendingTrans[i] = { handle: h };
		}
	}

	if (!enoughPlace){
		throw new Error('There is to much pending transaction')
	}
	log.debug("Transaction in progress",this.pendingTrans);
	log.debug("Current Transaction id",id);

	return id;
};

/******************************************************************************************************************
* Check Index
******************************************************************************************************************/
AdsClient.prototype.checkIndex = function(o){
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
			o.bytelength = adsProtocol.types[this.symbols[index].type].bytelength;
			o.type = this.symbols[index].type
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
			if (o.bytelength === undefined){
				o.bytelength = adsProtocol.types[this.symbols[index].type].bytelength;
				o.type = this.symbols[index].type
			} 
		}
		// Else try to send
		else{
			log.debug("The symbol doesn't exist Try to send",o);
			switch (o.bytelength){
    			case 1: o.type= "BOOL"; 	 	break;
    			case 2: o.type= "UINT"; 		break;
    			case 4: o.type= "REAL"; 		break;
    			case 8: o.type= "LREAL"; 		break;
			}
		}
	}
	else {
		//Error there is not enough information
		throw new Error("There is not enough information to send something",o);
	}

	return o;

};

/******************************************************************************************************************
* Generate Data Frame
******************************************************************************************************************/
AdsClient.prototype.genDataFrame = function (h){
	// Start to generate the frame
	var dataFrame;

	var dataSize = h.bytelength;

	switch (h.commandID){
		case adsProtocol.cmd_id["READ_DEVICE_INFO"] :
			dataFrame = new Buffer(0);
			break; 

		case adsProtocol.cmd_id["READ"] :
			dataFrame = new Buffer(	adsProtocol.frames["INDEX_GRP"].size + 
									adsProtocol.frames["INDEX_OFFSET"].size  + 
									adsProtocol.frames["LENGTH"].size);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.bytelength,8);
			break;

		case adsProtocol.cmd_id["WRITE"] :
			dataFrame = new Buffer(	adsProtocol.frames["INDEX_GRP"].size  + 
									adsProtocol.frames["INDEX_OFFSET"].size  + 
									adsProtocol.frames["LENGTH"].size  + 
									dataSize);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.bytelength,8);
			// Write data into the buffer
	    	switch(adsProtocol.types[h.type].bufferType) {
		        case "uint8": 	dataFrame.writeUInt8(h.value, 12); 										break;
		        case "int8": 		dataFrame.writeInt8(h.value, 12); 										break;
		        case "uint16LE": 	dataFrame.writeUInt16LE(h.value, 12); 									break;
		        case "int16LE": 	dataFrame.writeInt16LE(h.value, 12); 									break;
		        case "uint32LE": 	dataFrame.writeUInt32LE(h.value, 12);									break;
		        case "int32LE": 	dataFrame.writeInt32LE(h.value, 12);									break;
		        case "floatLE": 	dataFrame.writeFloatLE(h.value, 12);  									break;
		        case "doubleLE": 	dataFrame.writeFloatLE(h.value, 12);  									break;
		        default: 	dataFrame.write(h.value + "\0", 12, h.value.length, "utf8");  			break;
	    	}
			break;

		case adsProtocol.cmd_id["READ_STATE"] :
			dataFrame = new Buffer(0);			
			break; 

		case adsProtocol.cmd_id["WRITE_CONTROL"] :
			dataFrame = new Buffer(	adsProtocol.frames["ADS_STATE"].size +
									adsProtocol.frames["DEVICE_STATE"].size  + 
									adsProtocol.frames["LENGTH"].size );
			dataFrame.writeUInt16LE(h.adsState,0);
			dataFrame.writeUInt16LE(h.deviceState,2);
			// We can send data to add further information I just need to start or stop the PLC
			// Then I don't send more data
			dataFrame.writeUInt32LE(0x0000,4);	
			break; 

		case adsProtocol.cmd_id["ADD_NOTIFICATION"] :
			dataFrame = new Buffer(	adsProtocol.frames["INDEX_GRP"].size  + 
									adsProtocol.frames["INDEX_OFFSET"].size  + 
									adsProtocol.frames["LENGTH"].size  + 
									adsProtocol.frames["TRANSMOD"].size  + 
									adsProtocol.frames["MAX_DELAY"].size  + 
									adsProtocol.frames["CYCLE_TIME"].size  + 
									adsProtocol.frames["NOTIF_RESERVED"].size );
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(adsProtocol.types[h.type].bytelength,8);
			dataFrame.writeUInt32LE(h.transmissionMode,12);
			dataFrame.writeUInt32LE(h.maxDelay,16);
			dataFrame.writeUInt32LE(h.cycleTime,20);	
			dataFrame.writeDoubleLE(0,24);  //  -- reserved Bytes
			dataFrame.writeDoubleLE(0,32);		
			break; 

		case adsProtocol.cmd_id["DEL_NOTIFICATION"] :
			dataFrame = new Buffer(adsProtocol.frames["NOTIF_HANDLE"].size );
			dataFrame.writeUInt32LE(h.notifHandle,0);
			break; 

		case adsProtocol.cmd_id["READ_WRITE"] :
			dataSize = h.writeLength;
			dataFrame = new Buffer( adsProtocol.frames["INDEX_GRP"].size  + 
									adsProtocol.frames["INDEX_OFFSET"].size  + 
									adsProtocol.frames["LENGTH"].size  + 
									adsProtocol.frames["LENGTH"].size  + 
									dataSize);
			dataFrame.writeUInt32LE(h.indexGroup,0);
			dataFrame.writeUInt32LE(h.indexOffset,4);
			dataFrame.writeUInt32LE(h.readLength,8);
			dataFrame.writeUInt32LE(h.writeLength,12);
			// Write data into the buffer
	    	switch(adsProtocol.types[h.writeType].bufferType) {
		        case "uint8": 		dataFrame.writeUInt8(h.value, 16); 										break;
		        case "int8": 		dataFrame.writeInt8(h.value, 16); 										break;
		        case "uint16LE": 	dataFrame.writeUInt16LE(h.value, 16); 									break;
		        case "int16LE": 	dataFrame.writeInt16LE(h.value, 16); 									break;
		        case "uint32LE": 	dataFrame.writeUInt32LE(h.value, 16);									break;
		        case "int32LE": 	dataFrame.writeInt32LE(h.value, 16);									break;
		        case "floatLE": 	dataFrame.writeFloatLE(h.value, 16);  									break;
		        case "doubleLE": 	dataFrame.writeFloatLE(h.value, 16);  									break;
		        default: 	dataFrame.write(h.value + "\0", 16, h.value.length, "utf8");  			break;
	    	}
			break;
		
	}

	return dataFrame;
};

/******************************************************************************************************************
* Generate TCP Frame
******************************************************************************************************************/
AdsClient.prototype.genTcpFrame = function(h,d){
	var   	dataSize 		= d.length;

	// Generate the tcp Header
	var tcpHeader = new Buffer(adsProtocol.frames["TCP_HEAD"].size );
	tcpHeader[0] = 0x00;   									// -- 2 reserved Bytes
	tcpHeader[1] = 0x00;
	tcpHeader.writeUInt32LE(adsProtocol.frames["AMS_HEAD"].size   + dataSize, 2); 	// -- length of the data
	// Generate the AMS Header
	var amsHeader = new Buffer(adsProtocol.frames["AMS_HEAD"].size  );
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
	var frame = new Buffer(	adsProtocol.frames["TCP_HEAD"].size   + 
							adsProtocol.frames["AMS_HEAD"].size   + 
							dataSize);
	tcpHeader.copy(frame, 0, 0);
	amsHeader.copy(frame, adsProtocol.frames["TCP_HEAD"].size  );
	d.copy(frame, adsProtocol.frames["TCP_HEAD"].size   + adsProtocol.frames["AMS_HEAD"].size );

	return frame;
};

/******************************************************************************************************************
* HELPERS 
******************************************************************************************************************/

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

var getAdsState = function(id){
	for(var i =0; adsProtocol.states.length; i++){
		if(adsProtocol.states[i].id == id)
			return adsProtocol.states[i].name;
	}
	return "unknow";
}

var getError = function(id){
	for(var i =0; adsProtocol.errors.length; i++){
		if(adsProtocol.errors[i].id == id)
			return adsProtocol.errors[i].msg;
	}
	return "unknow error";
}


/**
 * Module exports.
 */

module.exports = exports = AdsClient;

















