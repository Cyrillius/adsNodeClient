describe("Device", function() {
 var AdsClient = null;
  
  beforeAll(function() {
    AdsClient  = require("../adsNodeClient.js");
  });

  it("should expose the default attributes", function() {
  	//default client
    var client1 = new AdsClient();

    expect(client1.host).toEqual('127.0.0.1');
    expect(client1.port).toEqual(48898);
    expect(client1.amsTargetNetID).toEqual([0,0,0,0,0,0]);
    expect(client1.amsSourceNetID).toEqual([0,0,0,0,0,0]);
    expect(client1.amsPortSource).toEqual(32905);
    expect(client1.amsPortTarget).toEqual(801);
    expect(client1.keepAlive).toEqual(false);
    expect(client1.autoConnect).toEqual(false);
    expect(client1.verbose).toEqual(false);
  });  

  it("should expose the specified attributes", function() {
  	// configured client
    var options = {
        host:  '192.168.89.1',
        port:  1234,
        amsTargetNetID: '1.2.3.4.5.6',
        amsSourceNetID: '192.168.189.989.111.222',
        amsPortSource: 9898, 
        amsPortTarget: 2424,
        keepAlive: true,
        autoConnect: true,
        verbose: true
    }; 	
  	var client2 = new AdsClient(options);

    expect(client2.host).toEqual(options.host);
    expect(client2.port).toEqual(options.port);
    expect(client2.amsTargetNetID).toEqual([1,2,3,4,5,6]);
    expect(client2.amsSourceNetID).toEqual([192,168,189,989,111,222]);
    expect(client2.amsPortSource).toEqual(options.amsPortSource);
    expect(client2.amsPortTarget).toEqual(options.amsPortTarget);
    expect(client2.keepAlive).toEqual(options.keepAlive);
    expect(client2.autoConnect).toEqual(options.autoConnect);
    expect(client2.verbose).toEqual(options.verbose);
  });

  it("should throw an error if the size of the amsNetID is too short", function() { 
  	// configured client
    var options1 = {
        host:  '192.168.89.1',
        port:  1234,
        amsTargetNetID: '1.2.3.4.5',
        amsSourceNetID: '192.168.189.989.111.222',
        amsPortSource: 9898, 
        amsPortTarget: 2424,
        keepAlive: true,
        autoConnect: true,
        verbose: true
    }; 

  	// configured client
    var options2 = {
        host:  '192.168.89.1',
        port:  1234,
        amsTargetNetID: '1.2.3.4.5.6',
        amsSourceNetID: '192.168.189.989.111',
        amsPortSource: 9898, 
        amsPortTarget: 2424,
        keepAlive: true,
        autoConnect: true,
        verbose: true
    }; 

  	expect(function(){new AdsClient(options1)}).toThrowError("Incorrect amsTargetNetID length");
  	expect(function(){new AdsClient(options2)}).toThrowError("Incorrect amsSourceNetID length");
  });

  it("should open a new connection automatically when autoconnect is true",function(){
    var options = {
        host:  '192.168.89.1',
        port:  1234,
        amsTargetNetID: '1.2.3.4.5.6',
        amsSourceNetID: '192.168.189.989.111.222',
        amsPortSource: 9898, 
        amsPortTarget: 2424,
        keepAlive: true,
        autoConnect: true,
        verbose: true
    };
    
    spyOn(AdsClient.prototype, 'open');
    var client = new AdsClient(options);

    expect(AdsClient.prototype.open).toHaveBeenCalled();
  })
    
});