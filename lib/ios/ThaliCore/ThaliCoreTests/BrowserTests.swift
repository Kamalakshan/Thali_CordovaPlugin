//
//  Thali CordovaPlugin
//  BrowserTests.swift
//
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license. See LICENSE.txt file in the project root for full license
//  information.
//

import XCTest
@testable import ThaliCore
import MultipeerConnectivity

class BrowserTests: XCTestCase {

    private func unexpectedFoundPeerHandler(peer: PeerIdentifier) {
        XCTFail("unexpected find peer event with peer: \(peer)")
    }

    private func unexpectedLostPeerHandler(peer: PeerIdentifier) {
        XCTFail("unexpected lost peer event with peer: \(peer)")
    }

    func testReceivedFailedStartBrowsingErrorOnMPCFBrowserDelegateCall() {
        // Preconditions
        let failedStartBrowsingExpectation =
            expectationWithDescription("failed start advertising because of delegate " +
                                       "MCNearbyServiceBrowserDelegate call")
        let serviceType = String.random(length: 7)
        let browser = Browser(serviceType: serviceType,
                              foundPeer: unexpectedFoundPeerHandler,
                              lostPeer: unexpectedLostPeerHandler)

        browser.startListening { [weak failedStartBrowsingExpectation] error in
            failedStartBrowsingExpectation?.fulfill()
        }

        // Send error start browsing failed error
        let peerID = MCPeerID(displayName: NSUUID().UUIDString)
        let mcBrowser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
        let error = NSError(domain: "org.thaliproject.test", code: 42, userInfo: nil)
        browser.browser(mcBrowser, didNotStartBrowsingForPeers: error)

        waitForExpectationsWithTimeout(1.0, handler: nil)
    }
}
