import ActivityKit
import Foundation
import React

// ── Public bridge (always available) ───────────────────────────────────────
@objc(LiveActivityBridge)
class LiveActivityBridge: RCTEventEmitter {

    private lazy var handler: AnyObject? = {
        if #available(iOS 16.2, *) { return LAHandler() }
        return nil
    }()

    override static func requiresMainQueueSetup() -> Bool { false }
    override func supportedEvents() -> [String]! { [] }

    @objc func startActivity(_ data: NSDictionary,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        if #available(iOS 16.2, *) {
            (handler as? LAHandler)?.start(data: data, resolve: resolve, reject: reject)
        } else {
            resolve(nil)
        }
    }

    @objc func updateActivity(_ data: NSDictionary) {
        if #available(iOS 16.2, *) { (handler as? LAHandler)?.update(data: data) }
    }

    @objc func endActivity() {
        if #available(iOS 16.2, *) { (handler as? LAHandler)?.end() }
    }
}

// ── ActivityKit implementation (iOS 16.2+ only) ────────────────────────────
@available(iOS 16.2, *)
private class LAHandler: NSObject {
    private var activityId: String?

    func start(data: NSDictionary,
               resolve: @escaping RCTPromiseResolveBlock,
               reject: @escaping RCTPromiseRejectBlock) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { resolve(nil); return }
        let attrs = TitanGolfActivityAttributes(
            matchId: data["matchId"] as? String ?? "",
            courseName: data["courseName"] as? String ?? "Golf Course"
        )
        do {
            let activity = try Activity<TitanGolfActivityAttributes>.request(
                attributes: attrs,
                content: ActivityContent(state: makeState(data), staleDate: nil)
            )
            activityId = activity.id
            resolve(activity.id)
        } catch {
            reject("LA_START_FAILED", error.localizedDescription, error)
        }
    }

    func update(data: NSDictionary) {
        guard let id = activityId else { return }
        let state = makeState(data)
        Task {
            for activity in Activity<TitanGolfActivityAttributes>.activities where activity.id == id {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            }
        }
    }

    func end() {
        guard let id = activityId else { return }
        activityId = nil
        Task {
            for activity in Activity<TitanGolfActivityAttributes>.activities where activity.id == id {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    private func makeState(_ data: NSDictionary) -> TitanGolfActivityAttributes.ContentState {
        let rawPlayers = (data["players"] as? [[String: Any]]) ?? []
        let players = rawPlayers.map { p in
            LivePlayer(
                name: p["name"] as? String ?? "?",
                pts: p["pts"] as? Int ?? 0,
                isLeader: p["isLeader"] as? Bool ?? false
            )
        }
        return TitanGolfActivityAttributes.ContentState(
            hole: data["hole"] as? Int ?? 1,
            par: data["par"] as? Int ?? 4,
            holesLeft: data["holesLeft"] as? Int ?? 18,
            format: data["format"] as? String ?? "stableford",
            players: players,
            matchScore: data["matchScore"] as? String
        )
    }
}
