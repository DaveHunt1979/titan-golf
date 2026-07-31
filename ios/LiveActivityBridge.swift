import ActivityKit
import Foundation
import React

@objc(LiveActivityBridge)
class LiveActivityBridge: RCTEventEmitter {
    private var currentActivityId: String?

    override static func requiresMainQueueSetup() -> Bool { false }
    override func supportedEvents() -> [String]! { [] }

    @objc func startActivity(_ data: NSDictionary,
                              resolver resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard #available(iOS 16.1, *) else { resolve(nil); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { resolve(nil); return }
        let attrs = TitanGolfActivityAttributes(
            matchId: data["matchId"] as? String ?? "",
            courseName: data["courseName"] as? String ?? "Golf Course"
        )
        let state = makeState(data)
        do {
            let activity = try Activity<TitanGolfActivityAttributes>.request(
                attributes: attrs,
                content: ActivityContent(state: state, staleDate: nil)
            )
            currentActivityId = activity.id
            resolve(activity.id)
        } catch {
            reject("LA_START_FAILED", error.localizedDescription, error)
        }
    }

    @objc func updateActivity(_ data: NSDictionary) {
        guard #available(iOS 16.1, *) else { return }
        guard let id = currentActivityId else { return }
        let state = makeState(data)
        Task {
            for activity in Activity<TitanGolfActivityAttributes>.activities where activity.id == id {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            }
        }
    }

    @objc func endActivity() {
        guard #available(iOS 16.1, *) else { return }
        guard let id = currentActivityId else { return }
        currentActivityId = nil
        Task {
            for activity in Activity<TitanGolfActivityAttributes>.activities where activity.id == id {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    @available(iOS 16.1, *)
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
