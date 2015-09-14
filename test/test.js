 	AdsClient = require("./adsNodeClient");

 	var options = {
 		host : '149.156.138.72',
 		port : 48898,
 		amsTargetNetID : '5.10.0.204.1.1',
 		amsSourceNetID : '192.168.1.101.1.1',
 		amsPortTarget : 801,
 		amsPortSource : 32905,
 		verbose: true,
 		keepAlive: false
 	};
 	var ads = new AdsClient(options);

 	ads.on("connect",function(){
 		var handle = {
 			symname: ".I_ACK", 
 		}
 		
 		ads.read(handle,function(response){
 			console.log(response.data.value);
 			handle.value = true;
 			ads.write(handle,function(){
 				ads.read(handle,function(response){
 					console.log(response.data.value);
 				});
 			});
 		});

 		ads.subscribe(handle);

 		ads.on("valueChange", function(response){
 			console.log("New Value !!",response);
 		});
 		handle.value = false;
 		ads.write(handle,function(){
 			handle.value = true;
	 		ads.write(handle,function(){

	 		});
 		});



 	});

