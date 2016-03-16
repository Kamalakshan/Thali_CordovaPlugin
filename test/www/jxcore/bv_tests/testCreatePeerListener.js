'use strict';

var originalMobile = typeof Mobile === 'undefined' ? undefined : Mobile;
var mockMobile = require('../lib/MockMobile');
var net = require('net');
var multiplex = require('multiplex');
var tape = require('../lib/thali-tape');
var ThaliTCPServersManager = require('thali/NextGeneration/mux/thaliTcpServersManager');
var makeIntoCloseAllServer = require('thali/NextGeneration/makeIntoCloseAllServer');
var Promise = require('lie');

// Every call to Mobile trips this warning
/* jshint -W064 */

// Does not currently work in coordinated
// environment, because uses fixed port numbers.
if (tape.coordinated) {
  return;
}

var applicationPort = 4242;
var nativePort = 4040;
var serversManager = null;

var test = tape({
  setup: function (t) {
    global.Mobile = mockMobile;
    serversManager = new ThaliTCPServersManager(applicationPort);
    t.end();
  },
  teardown: function (t) {
    (serversManager ? serversManager.stop() : Promise.resolve())
      .catch(function (err) {
        t.fail('serversManager had stop error ' + err);
      })
      .then(function () {
        global.Mobile = originalMobile;
        t.end();
      });
  }
});

test('calling createPeerListener without calling start produces error',
  function (t) {
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('calling createPeerListener after calling stop produces error',
  function (t) {
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('can call createPeerListener (pleaseConnect === false)', function (t) {
  serversManager.start()
    .then(function () {
      serversManager.createPeerListener('peerId', false)
        .then(function (peerPort) {
          t.ok(peerPort > 0 && peerPort <= 65535, 'port must be in range');
          t.end();
        });
    })
    .catch(function () {
      t.fail('server should not get error');
      t.end();
    });
});

test('calling createPeerListener (pleaseConnect === true) with unknown peer ' +
  'is error',
  function (t) {
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb('Unknown Peer');
    });

    serversManager.start()
      .then(function () {
        serversManager.createPeerListener('peerId', true)
          .catch(function (err) {
            // Should get an error here, we haven't yet started browsing or
            // discovered any peers
            t.ok(err, 'should get error');
            t.end();
          });
      })
      .catch(function (err) {
        t.fail('server should not get error - ' + err);
        t.end();
      });
  }
);

/*
 //////////////////////////////////////////////////////////////////////////
 Now we get to the complex stuff
 //////////////////////////////////////////////////////////////////////////

 ///////////////////////
 Some utility functions
 */

function waitForPeerAvailabilityChanged(t, serversManager, dontFail, then) {
  Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
    peers.forEach(function (peer) {
      if (peer.peerAvailable) {
        serversManager.createPeerListener(peer.peerIdentifier,
          peer.pleaseConnect)
          .then(function (peerPort) {
            if (then) {
              then(peerPort);
            }
          })
          .catch(function (err) {
            if (!dontFail) {
              t.fail('Unexpected rejection creating peer listener' + err);
              console.warn(err);
            }
          });
      }
    });
  });
}

function startAdvertisingAndListening(t, applicationPort, pleaseConnect) {

  Mobile('startUpdateAdvertisingAndListening').callNative(applicationPort,
    function (err) {
      t.notOk(err, 'Can call startUpdateAdvertisingAndListening without error');
      Mobile('startListeningForAdvertisements').callNative(function (err) {
        t.notOk(err, 'Can call startListeningForAdvertisements without error');
        Mobile('peerAvailabilityChanged').callRegistered([{
          peerIdentifier : 'peer1',
          pleaseConnect : pleaseConnect,
          peerAvailable: true
        }]);
      });
    });
}

function startServersManager(t, serversManager) {
  serversManager.start().then(function () {
    })
    .catch(function (err) {
      t.fail('server should not get error: ' + err);
    });
}

function setUp(t, serversManager, appPort, forwardConnection, pleaseConnect,
               dontFail, then) {
  waitForPeerAvailabilityChanged(t, serversManager, dontFail, then);
  startServersManager(t, serversManager);

  if (forwardConnection !== 0) {
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb(null,
        Mobile.createListenerOrIncomingConnection(forwardConnection, 0, 0));
    });
  }
  else {
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb(null, Mobile.createListenerOrIncomingConnection(0, 0,
        serversManager._nativeServer.address().port));
    });
  }

  startAdvertisingAndListening(t, appPort, pleaseConnect);
}

/*
 End of Utility functions
 /////////////////////////
 */

test('peerListener - forwardConnection, pleaseConnect === true - no native ' +
  'server',
  function (t) {
    var promiseRejected = false;
    var failedConnection = false;

    // We expect 'failedConnection' since there's no native listener
    serversManager.on('failedConnection', function (err) {
      t.equal(err.error, 'Cannot Connect To Peer',
        'reason should be as expected');
      failedConnection = true;
      if (promiseRejected) {
        t.end();
      }
    });

    // Have the next Mobile("connect") call complete with a forward connection
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb(null, Mobile.createListenerOrIncomingConnection(nativePort, 0, 0));
    });

    // Promise should be rejected when we fail to open a socket to the native
    // listener
    Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
      peers.forEach(function (peer) {
        if (peer.peerAvailable) {
          serversManager.createPeerListener(peer.peerIdentifier,
            peer.pleaseConnect)
            .then(function (peerPort) {
              t.fail('We should have gotten rejected');
            })
            .catch(function () {
              t.ok(true, 'Expected a reject');
              promiseRejected = true;
              console.log(serversManager);
              if (failedConnection) {
                t.end();
              }
            });
        }
      });
    });

    startServersManager(t, serversManager);
    startAdvertisingAndListening(t, applicationPort, true);
  }
);

test('peerListener - forwardConnection, pleaseConnect === false - no native ' +
  'server',
  function (t) {
    var firstConnection = false;

    // We expect 'failedConnection' since there's no native listener
    serversManager.on('failedConnection', function (err) {
      t.ok(firstConnection, 'Should not get event until connection is made');
      t.equal(err.error, 'Cannot Connect To Peer',
        'reason should be as expected');
      t.end();
    });

    setUp(t, serversManager, applicationPort, nativePort, false, false,
      function (peerPort) {
        t.notEqual(peerPort, nativePort, 'peerPort should not be nativePort');
        net.createConnection(peerPort);
        firstConnection = true;
      });
  }
);

test('peerListener - forwardConnection, pleaseConnect === true - with native ' +
  'server',
  function (t) {
    var outgoingSocket;
    var serverAccepted = false;
    var clientConnected = false;

    serversManager.on('failedConnection', function () {
      t.fail('Shouldn\'t fail to connect to native listener');
    });

    var nativeServer = net.createServer(function (socket) {
      serverAccepted = true;
      outgoingSocket = socket;
      t.ok(true, 'Should get spontaneous connection');
      if (clientConnected) {
        outgoingSocket.end();
        nativeServer.close();
        t.end();
      }
    });

    nativeServer.listen(nativePort, function (err) {
      if (err) {
        t.fail('nativeServer should not fail');
        t.end();
      }
    });

    setUp(t, serversManager, applicationPort, nativePort, true, false,
      function (peerPort) {
        clientConnected = true;
        t.notEqual(peerPort, nativePort, 'peerPort != nativePort');
        if (serverAccepted) {
          outgoingSocket.end();
          nativeServer.close();
          t.end();
        }
      }
    );
  }
);

test('peerListener - forwardConnection, pleaseConnect === false - with ' +
  'native server',
  function (t) {
    var firstConnection = false;

    serversManager.on('failedConnection', function () {
      t.fail('connection shouldn\'t fail');
    });

    var nativeServer = net.createServer(function (socket) {
      t.ok(firstConnection, 'Should not get unexpected connection');
      nativeServer.close();
      socket.end();
      t.end();
    });
    nativeServer.listen(nativePort, function (err) {
      if (err) {
        t.fail('nativeServer should not fail');
        t.end();
      }
    });

    setUp(t, serversManager, applicationPort, nativePort, false, false,
      function (peerPort) {
        t.notEqual(peerPort, nativePort, 'peerPort != nativePort');
        // Need to connect a socket to force the outgoing
        net.createConnection(peerPort);
        firstConnection = true;
      }
    );
  }
);

test('peerListener - forwardConnection, pleaseConnect === false - with ' +
  'native server and data transfer',
  function (t) {
    var data = new Buffer(10000);

    serversManager.on('failedConnection', function () {
      t.fail('connection shouldn\'t fail');
    });

    var connectionCount = 0;
    var nativeServer = net.createServer(function (socket) {
      function endTest() {
        nativeServer.close();
        socket.end();
        t.end();
      }
      var localData = new Buffer(0);
      ++connectionCount;
      t.equal(connectionCount, 1, 'We should only get one connection');

      socket.on('error', function (err) {
        t.fail('Got error on socket - ' + err);
      });

      socket.on('data', function (data) {
        localData = Buffer.concat([localData, data]);
        if (localData.length === data.length) {
          t.ok(Buffer.compare(localData, data) === 0, 'buffers should be ' +
            'identical');
          return endTest();
        }

        if (localData.length > data.length) {
          t.fail('Data was too long - ' + localData.length);
          return endTest();
        }
      });
    });
    nativeServer.listen(nativePort, function (err) {
      if (err) {
        t.fail('nativeServer should not fail');
        t.end();
      }
    });

    setUp(t, serversManager, applicationPort, nativePort, false, false,
      function (peerPort) {
        t.notEqual(peerPort, nativePort, 'peerPort != nativePort');
        // Need to connect a socket to force the outgoing
        var outgoing = net.createConnection(peerPort, function () {
          var mux = multiplex();
          outgoing.pipe(mux).pipe(outgoing);
          var stream = mux.createStream();
          stream.write(data);
          stream.on('error', function (err) {
            t.fail('stream error ' + err);
            t.end();
          })
        });
        outgoing.on('error', function (err) {
          t.fail('createConnection failed - ' + err);
          nativeServer.close();
          t.end();
        });
      }
    );
  }
);

test('createPeerListener is idempotent', function (t) {
  serversManager.on('failedConnection', function () {
    t.fail('connection shouldn\'t fail');
    t.end();
  });

  waitForPeerAvailabilityChanged(t, serversManager, false, function (peerPort) {
    // Create another peerListener to peer1
    serversManager.createPeerListener('peer1', false)
      .then(function (port) {
        t.equal(peerPort, port,
          'Second call to existing peerListener returns existing port');
        t.end();
      })
      .catch(function (err) {
        t.fail('should not get error - ' + err);
        t.end();
      });
  });

  startServersManager(t, serversManager);
  startAdvertisingAndListening(t, applicationPort, false);
});

test('createPeerListener - pleaseConnect === true, failed connection rejects ' +
  'promise',
  function (t) {
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb('a nasty error');
    });

    serversManager.on('failedConnection', function () {
      t.fail('connection shouldn\'t fail');
      t.end();
    });

    Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
      peers.forEach(function (peer) {
        if (peer.peerAvailable) {
          serversManager.createPeerListener(peer.peerIdentifier,
            peer.pleaseConnect)
            .then(function () {
              t.fail('should not succeed when connection fails');
              t.end();
            })
            .catch(function (err) {
              t.equal(err.message, 'a nasty error',
                'failed connection should reject with error');
              t.end();
            });
        }
      });
    });

    startServersManager(t, serversManager);
    startAdvertisingAndListening(t, applicationPort, true);
  }
);

test('createPeerListener - pleaseConnect === true, connection resolves promise',
  function (t) {
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      cb(null, Mobile.createListenerOrIncomingConnection(nativePort, 0, 0));
    });

    serversManager.on('failedConnection', function () {
      if (!serversManager._closing) {
        t.fail('Shouldn\'t fail to connect to native listener');
        t.end();
      }
    });

    var nativeServer = net.createServer(function (socket) {
      t.ok(true, 'Should get spontaneous connection');
      socket.end();
    });

    nativeServer.listen(nativePort, function (err) {
      if (err) {
        t.fail('nativeServer should not fail');
        t.end();
      }
    });

    Mobile('peerAvailabilityChanged').registerToNative(function (peers) {
      peers.forEach(function (peer) {
        if (peer.peerAvailable) {
          serversManager.createPeerListener(peer.peerIdentifier,
            peer.pleaseConnect)
            .then(function () {
              t.ok(true, 'promise should resolve');
              nativeServer.close();
              t.end();
            })
            .catch(function (err) {
              t.fail('should not fail - ' + err);
              nativeServer.close();
              t.end();
            });
        }
      });
    });

    startServersManager(t, serversManager);
    startAdvertisingAndListening(t, applicationPort, true);
  }
);

/*
 reverseConnections
 ///////////////////
 */

test('peerListener - reverseConnection, pleaseConnect === true', function (t) {
  // We expect 'failedConnection' since pleaseConnect should
  // never result in a reverseConnection
  serversManager.on('failedConnection', function (err) {
    t.equal(err.error, 'Cannot Connect To Peer',
      'reason should be as expected');
    t.end();
  });

  // Note: Here we're saying dontFail on createPeerListener rejecting
  // since we expect to fail because of the unexpected reverse connection
  setUp(t, serversManager, applicationPort, 0, true, true, function (peerPort) {
    t.notEqual(peerPort, nativePort, 'peerPort should not be nativePort');
  });
});

test('peerListener - reverseConnection, pleaseConnect === false - no incoming',
  function (t) {
    var firstConnection = false;

    // We expect 'Incoming connction died' since we're forcing a reverse
    // connection but there's been no incoming connection
    serversManager.on('failedConnection', function (err) {
      t.ok(firstConnection, 'should not get event until connection is made');
      t.equal(err.error, 'Incoming connection died',
        'reason should be as expected');
      t.end();
    });

    setUp(t, serversManager, applicationPort, 0, false, false,
      function (peerPort) {
        t.notEqual(peerPort, nativePort, 'peerPort should not be nativePort');
        net.createConnection(peerPort);
        firstConnection = true;
      }
    );
  }
);

test('peerListener - reverseConnection, pleaseConnect === false - with ' +
  'incoming',
  function (t) {
    serversManager.on('failedConnection', function () {
      t.fail('connection shouldn\'t fail');
    });

    // We're going to unroll setUp here 'cause we want to do some
    // funky stuff

    var toSend = 'hello';
    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      // Here we're pretending to be the p2p layer connecting to the
      // servers manager
      var serverPort = serversManager._nativeServer.address().port;
      var incoming = net.createConnection(serverPort, function () {
        var mux = multiplex(function onStream(stream) {
          stream.write(toSend);
        });
        incoming.pipe(mux).pipe(incoming);
        process.nextTick(function () {
          cb(null, Mobile.createListenerOrIncomingConnection(
            0,
            incoming.address().port,
            serverPort));
        });
      });

    });

    waitForPeerAvailabilityChanged(t, serversManager, false,
      function (peerPort) {
        // Create a client connection to our local server, this'll cause the p2p
        // connection to be established. We've arranged for this to result in a
        // reverse connection so when out connection completes we expect there
        // to be a mux available on which we'll create a new stream which we'll
        // pipe to our client socket
        var client = net.createConnection(peerPort, function () {
        });
        var toRecv = '';
        client.on('data', function (data) {
          toRecv += data.toString();
          if (toRecv.length >= toSend.length) {
            t.equal(toSend, toRecv, 'sent and received should be the same');
            t.end();
          }
        });
      }
    );

    startServersManager(t, serversManager);
    startAdvertisingAndListening(t, applicationPort, false);
  }
);

test('peerListener - reverseConnection, pleaseConnect === false - no server',
  function (t) {
    serversManager.on('failedConnection', function () {
      t.fail('connection shouldn\'t fail');
    });

    // We expect the stream created by the incoming socket to
    // trigger routerPortConnection failed since there's no app listening
    serversManager.on('routerPortConnectionFailed', function () {
      t.ok(true, 'should get routerPortConnectionFailed');
      t.end();
    });

    Mobile('connect').nextNative(function (peerIdentifier, cb) {
      var serverPort = serversManager._nativeServer.address().port;
      var incoming = net.createConnection(serverPort, function () {
        var mux = multiplex(function onStream() {
        });
        incoming.pipe(mux).pipe(incoming);
        // Force the other side to connect to it's (non-existent in this case)
        // application server
        var stream = mux.createStream();
        stream.on('error', function () {});
        process.nextTick(function () {
          cb(null, Mobile.createListenerOrIncomingConnection(
            0,
            incoming.address().port,
            serverPort));
        });
      });
    });

    waitForPeerAvailabilityChanged(t, serversManager, false,
      function (peerPort) {
        net.createConnection(peerPort, function () {});
      }
    );

    startServersManager(t, serversManager);
    startAdvertisingAndListening(t, applicationPort, false);
  }
);

test('createPeerListener - ask for new peer when we are at maximum and make ' +
  'sure we remove the right existing listener', function (t) {
  // We need to send data across the listeners so we can control their last
  // update time and then prove we close the right one, the oldest
  serversManager.start()
    .then(function () {
      t.end();
    });
});

test('createPeerListener - ask for a new peer when we are not at maximum ' +
  'peers and make sure we do not remove any existing listeners', function (t){
  serversManager.start()
    .then(function () {
      t.end();
    });
});

test('createPeerListener - pleaseConnect = false - test timeout', function (t) {
  // We have to prove to ourselves that once we connect to the listener and
  // the connection is created that if the native link goes inactive long
  // enough we will properly close it and clean everything up.
  serversManager.start()
    .then(function () {
      t.end();
    });
});

test('createPeerListener - pleaseConnect = true - test timeout', function (t) {
  // We have to prove that we start counting timeout on the native link as
  // soon as we create it for the pleaseConnect = true and that it will close
  // itself and clean everything up.
  serversManager.start()
    .then(function () {
      t.end();
    });
});

test('createPeerListener - forward connection - wrong serverPort',
  function (t) {
    // In the connect if clientPort/serverPort are set then we have to compare
    // the listed serverPort with the serverPort we are listening on. If they
    // don't match then we have to close the port we are listening on, first
    // a failedConnection event with "Mismatched serverPort" and an attempt
    // to reconnect to the same peer ID should be treated, fresh, e.g. not
    // history of the failed attempt.
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('createPeerListener - forward connection - wrong clientPort',
  function (t) {
    // In the connect if clientPort/serverPort are set then we have to compare
    // the listed clientPort with the clientPorts we currently have multiplexes
    // for. If we don't find one then we have a race condition and we need to
    // call destroy on the incoming TCP connection, fire a failedConnection
    // event with the error "Incoming connection died" and as with the previous
    // test, treat a new request as 'fresh', no history.
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('createPeerListener - please connect = false, multiple connections out',
  function (t) {
    // Create an outgoing connection and then open a bunch of TCP links to
    // the server and show that they properly send everything across all the
    // links to the server on the other side. Also show that when we shut things
    // down we clean everything up properly.
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('createPeerListener - please connect = false, multiple bi-directional ' +
  'connections',
  function (t) {
    // Trigger an outgoing connection and then have multiple connections
    // going in both directions (e.g. the iOS scenario) and make sure that
    // everything is fine and then close it all down and make sure we clean
    // up right.
    serversManager.start()
      .then(function () {
        t.end();
      });
  });

test('createPeerListener - multiple parallel calls', function (t) {
  // Unlike createNativeListener, it's completely legal to have multiple
  // parallel calls to createPeerListener, we need to test what happens
  // when we have multiple calls in parallel and make sure that nothing
  // breaks.
  serversManager.start()
    .then(function () {
      t.end();
    });
});
