
# adsNodeClient

ADS TWINCAT Client for Node.js

A Node.js implementation for the TWINCAT protocol oriented event.

**This library is for the moment not really operational only write and read method can be used. Please be patient :)**

## How to use
```javascript
var AdsNodeClient = require('ads-node-client');
 
var options = {
    host: "192.168.2.4", 
    amsTargetNetID: "5.27.156.9.1.1", 
    amsSourceNetID: "192.168.2.2.0.0", 
}; 
 
var ads = new AdsNodeClient(options);
ads.open();
 
ads.on('connect', function() {
    console.log('#ADS new Connection');
});
```	

## API

### Class
   
exposed by  ```require('ads-node-client');```
   
### Constructor(options)

```javascript
var AdsNodeClient = require('ads-node-client');
var ads = new AdsNodeClient(options);
```
__Parameter:__

- options: Object contain the client options

| Name             | Description                 | Default | Required |
|------------------|-----------------------------|---------|----------|
|`host`            | the ip adress of the target |         | yes      |
|`port`            | the tcp port of the target  | 48898   | no       |
|`amsTargetNetID`  | AMS Net ID of the target    |         | yes      |
|`amsSourceNetID`  | AMS Net ID of the source    |         | yes      |
|`amsPortSource:`  | AMS port of the source      | 32905   | no       |
|`amsPortTarget:`  | AMS port of the target      | 801     | no       |
|`keepAlive:`      | maintain the connection open| false   | no       |
|`verbose:`        | display debug messages      | false   | no       |

__Return:__

Object | an instance of the adsNodeClient class 

### Method open()

open the connection

```javascript
ads.open();
```
__Parameter:__

none

__Return:__

Socket the socket used for the connection


### Method close()

close the connection

Not yet implemented

### Method readDeviceInfo(cb)

close the connection

```javascript
ads.readDeviceInfo();
```
__Parameter:__

- cb executed when the response is received

__Return:__

Integer the id of the transaction

### Method readState(cb)

read the state of the PLC

```javascript
ads.readState();
```

__Parameter:__

- cb: Function executed when the response is received

__Return:__

Integer the id of the transaction


### Method read(options, cb)

read the value of a variable

```javascript
var handle = {
	symname:".START"
}
ads.read(handle,function(response){
    console.log(response.data.value);
});
```

__Parameter:__

- options: Object containing the request option

| Name             | Description                 | Default | Required                                         |
|------------------|-----------------------------|---------|--------------------------------------------------|
|`symname`         | the symbol name             |         | if indexGroup and indexOffset are not defined    |
|`indexGroup`      | the tcp port of the target  | 48898   | if symname not defined                           |
|`indexOffset`     | AMS Net ID of the target    |         | if symname not defined                           |
|`bytelength`      | AMS Net ID of the source    |         | yes                                              |

- cb: Function executed when the response is received

__Return:__

Integer the id of the transaction

### Method write(options, cb)

assign a value to a variable

```javascript
var handle = {
	symname:".START",
    value: true
}
ads.write(handle,function(response){
    console.log("write request sended");
});
```

__Parameter:__

- options: Object containing the request option

| Name             | Description                 | Default | Required                                         |
|------------------|-----------------------------|---------|--------------------------------------------------|
|`symname`         | the symbol name             |         | if indexGroup and indexOffset are not defined    |
|`indexGroup`      | the tcp port of the target  | 48898   | if symname not defined                           |
|`indexOffset`     | AMS Net ID of the target    |         | if symname not defined                           |
|`bytelength`      | AMS Net ID of the source    |         | yes                                              |

- cb: Function executed when the response is received

__Return:__

Integer the id of the transaction

### Method subscribe(options, cb)

subscribe to be notified when a value change

```javascript
var handle = {
	symname:".START"
}
var notifHandle = ads.subscribe(handle,function(response){
    console.log("start listen");
});

ads.on("valueChange", function(response){
	if(response.data.notifHandle == notifHandle){
    	console.log(response.data.value);
    }
}
```

__Parameter:__

- options: Object containing the request option

| Name             | Description                 | Default | Required                                         |
|------------------|-----------------------------|---------|--------------------------------------------------|
|`symname`         | the symbol name             |         | if indexGroup and indexOffset are not defined    |
|`indexGroup`      | the tcp port of the target  | 48898   | if symname not defined                           |
|`indexOffset`     | AMS Net ID of the target    |         | if symname not defined                           |
|`bytelength`      | AMS Net ID of the source    |         | yes                                              |

- cb: Function executed when the response is received

__Return:__

Integer the id of the transaction

### Method unsubscribe()

stop be notified when a value change

Not yet implemented

### Events

```javascript
ads.on("valueChange", function(response){
    console.log(response.data.value);
}
```

| Name                 | Description                                | 
|----------------------|--------------------------------------------|
|`open`                | the connection is open                     |   
|`close`               | the connection is closed                   |
|`end`                 | The other end close the socket             | 
|`receive`             | Some data has been received                |
|`error`               | There is an error                          |
|`deviceInfoResponse`  | Device Information received                |
|`readWriteResponse`   | Read Write response received               |
|`readResponse`        | Read response received                     |
|`deleteNotifResponse` | Delete notification response received      |
|`writeControlResponse`| Write control response received            |
|`writeResponse`       | Write response received                    |
|`readStateResponse`   | Read state response received               |
|`addNotifResponse`    | Add notification response received         |
|`valueChange`         | A variable value changed                   |
|`newNotification`     | New notification request received          |