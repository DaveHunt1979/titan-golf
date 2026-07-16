import Foundation
import WatchConnectivity
import React

@objc(WatchBridge)
class WatchBridge: RCTEventEmitter, WCSessionDelegate {

    // Cached last-known context so Swift can resend without a JS round-trip
    private var pendingMatchContext: [String: Any]?
    private var pendingSoloContext: [String: Any]?

    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    override func supportedEvents() -> [String] {
        return ["onWatchScoreEntry", "onWatchSoloScoreEntry", "onWatchRequestsState"]
    }

    override static func requiresMainQueueSetup() -> Bool { return false }

    // MARK: - Called from JS

    @objc func sendMatchToWatch(_ data: NSDictionary) {
        var message = (data as? [String: Any]) ?? [:]
        message["type"] = "matchUpdate"
        pendingMatchContext = message
        pendingSoloContext = nil
        push(message)
    }

    @objc func sendSoloMatchToWatch(_ data: NSDictionary) {
        let message = (data as? [String: Any]) ?? [:]
        pendingSoloContext = message
        pendingMatchContext = nil
        push(message)
    }

    @objc func clearMatchFromWatch() {
        let message: [String: Any] = ["type": "clearMatch"]
        pendingMatchContext = nil
        pendingSoloContext = nil
        try? WCSession.default.updateApplicationContext(message)
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil, errorHandler: nil)
        }
    }

    // MARK: - Internal send

    private func push(_ message: [String: Any]) {
        guard WCSession.default.activationState == .activated else { return }
        // updateApplicationContext persists until Watch reads it — most reliable
        try? WCSession.default.updateApplicationContext(message)
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil, errorHandler: nil)
        } else if WCSession.default.isPaired && WCSession.default.isWatchAppInstalled {
            WCSession.default.transferUserInfo(message)
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        // Session just became active — flush any context that was queued before activation completed
        if let ctx = pendingMatchContext ?? pendingSoloContext {
            push(ctx)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncoming(message)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        handleIncoming(userInfo)
    }

    private func handleIncoming(_ message: [String: Any]) {
        guard let type = message["type"] as? String else { return }
        switch type {
        case "scoreEntry":
            sendEvent(withName: "onWatchScoreEntry", body: message)
        case "soloScoreEntry":
            sendEvent(withName: "onWatchSoloScoreEntry", body: message)
        case "requestState":
            // Resend cached context directly from Swift — no JS round-trip needed
            if let ctx = pendingMatchContext ?? pendingSoloContext {
                push(ctx)
            }
            // Also notify JS as a belt-and-suspenders backup
            sendEvent(withName: "onWatchRequestsState", body: [:])
        default:
            break
        }
    }
}
