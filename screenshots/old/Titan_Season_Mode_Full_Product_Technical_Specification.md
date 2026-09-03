# Titan Season Mode

**Full Product, Rules & Technical Specification**

**Recommended V1 Format:** Stableford

Football-style divisions • Best 20 rounds • Automatic promotion & relegation • 4 Majors • League PIN • Existing AI News Engine integration

**Version 1.0 | 2 September 2026**

## Executive Decision

> **RECOMMENDED FORMAT: STABLEFORD**
>
> Titan Season Mode should use individual Stableford as the core round format rather than stroke play. It is better suited to mixed-handicap amateur golf, keeps a player interested after one bad hole, makes 'playing to handicap' easy to understand (36 Stableford points under the default Titan allowance), and produces a cleaner season-long competition. The app still stores every gross hole score, so the raw golf data is retained.

The original idea of rewarding birdies, pars and bogeys is retained in spirit, but the default V1 scoring is adjusted to avoid double-counting what Stableford already measures. Titan uses the Stableford total as the core score, adds a performance bonus for the 18-hole Stableford result, and adds smaller bonuses for exceptional gross achievements such as birdies and eagles.

| **Rule**           | **Default**                                                           |
|--------------------|-----------------------------------------------------------------------|
| Core golf format   | Individual 18-hole Stableford                                         |
| Counting rounds    | Best 20 verified qualifying rounds                                    |
| Minimum to qualify | 20 qualifying rounds                                                  |
| Group requirement  | Minimum 2-ball                                                        |
| Verification       | At least one playing partner verifies the round                       |
| Promotion          | Top 3 automatically promoted by default                               |
| Relegation         | Bottom 3 automatically relegated by default                           |
| Majors             | 4 per season, default 1.5× multiplier                                 |
| Joining            | 6-digit Season PIN + admin approval by default                        |
| News               | Feeds structured Season events into the existing Titan AI News Engine |

### Why Stableford Is Better for Titan Season

- One disaster hole does not destroy an entire round, which keeps the season engaging.
- It is familiar to the amateur/society golf audience Titan is aimed at.
- It naturally adjusts hole-by-hole for handicap using Stroke Index.
- A 36-point benchmark gives Titan a simple definition of 'played to handicap' under the default Season rules.
- It works well with a Best 20 system because every round produces a comparable, intuitive number.
- The app still captures gross scores hole-by-hole, so Titan can calculate statistics, birdies/eagles and future formats.

> **IMPORTANT SCORING CHANGE**
>
> Do not use +5 for every gross par and -2 for every gross bogey in the default Stableford profile. Stableford already rewards net par/birdie and penalises poor holes. Adding large par/bogey values on top would make the system harder to understand and would disproportionately reward lower-handicap players. The scoring profile remains configurable so Titan can test alternate values later.

## Specification Contents

- 1. Product Vision & Objectives
- 2. Terminology & Core Definitions
- 3. Season Lifecycle
- 4. League Joining, PINs & Registration
- 5. Division Structure & Initial Placement
- 6. Promotion, Relegation & Future Seasons
- 7. Player & Round Eligibility
- 8. Stableford Calculation Rules
- 9. Titan Round Scoring Engine
- 10. Best 20 System
- 11. Titan Majors
- 12. Score Verification & Anti-Cheating
- 13. League Tables, Qualification & Tiebreakers
- 14. Existing Titan AI News Engine Integration
- 15. Notifications & Player Engagement
- 16. Player UX & Required Screens
- 17. Admin Control Panel
- 18. Data Model
- 19. Services & Backend Architecture
- 20. Event Model & Recalculation
- 21. Season Close & Rollover
- 22. Edge Cases & Failure Conditions
- 23. Acceptance Tests
- 24. Future Extensibility
- Appendix A. Default Configuration
- Appendix B. Worked Scoring Examples

## 1. Product Vision & Objectives

Titan Season Mode is a year-long individual golf competition designed to feel like a football league. Players enter a structured league pyramid, build a season score from their best performances, chase promotion, fight relegation, compete in four Majors and follow league stories through Titan's existing AI-generated news system.

### 1.1 Core Gameplay Loop

```text
JOIN SEASON
↓
DIVISION ASSIGNED
↓
PLAY VERIFIED STABLEFORD ROUNDS
↓
BEST 20 AUTOMATICALLY UPDATED
↓
LEAGUE POSITION CHANGES
↓
NEWS / NOTIFICATIONS
↓
MAJORS + PROMOTION / RELEGATION RACE
↓
SEASON CLOSE + NEXT-SEASON DIVISION
```

### 1.2 Design Principles

- The app handles the competition automatically once the Season is configured.
- Every result must be deterministic and reproducible from stored raw data.
- Players can play unlimited qualifying rounds; only their best 20 count.
- The mode must remain fair and understandable across a wide handicap range.
- No user or administrator should need to calculate points, promotion or Major status manually.
- The competition engine calculates facts; the existing Titan AI News Engine tells the story.

## 2. Terminology & Core Definitions

| **Term**                | **Definition**                                                                      |
|-------------------------|-------------------------------------------------------------------------------------|
| Season                  | A configured Titan Season competition with start/end dates and one league pyramid.  |
| Season Entry            | One player's participation record in one Season.                                    |
| Division                | Premier League, Championship, League One, etc.                                      |
| Qualifying Round        | An eligible, verified 18-hole round accepted by Season Mode.                        |
| Counting Round          | A qualifying round currently included in the player's Best 20.                      |
| Non-Counting Round      | A valid qualifying round outside the player's current Best 20.                      |
| Season Points           | Sum of the player's current counting Titan Round Points.                            |
| Stableford Total        | 18-hole individual Stableford points calculated by Titan.                           |
| Performance Bonus       | Bonus based on the player's 18-hole Stableford total.                               |
| Gross Achievement Bonus | Bonus for defined gross achievements such as birdie/eagle.                          |
| Major                   | One of four configured Season windows with an additional multiplier.                |
| Qualified               | Player has completed at least the configured minimum qualifying rounds, default 20. |
| DNQ                     | Did Not Qualify at Season close.                                                    |

## 3. Season Lifecycle

```text
DRAFT
→ REGISTRATION_OPEN
→ REGISTRATION_CLOSED
→ DIVISIONS_PREVIEW
→ PUBLISHED
→ ACTIVE
→ VERIFICATION_GRACE
→ FINALISING
→ LOCKED
→ ARCHIVED
```

### 3.1 Required Season Configuration

- Season name and year.
- Season timezone.
- Registration open and close timestamps.
- Season start and end timestamps.
- Verification grace period.
- Division names and target sizes.
- Promotion and relegation places.
- Minimum qualifying rounds and counting-round limit.
- Stableford/handicap allowance profile.
- Titan scoring profile.
- Four Major definitions.
- Join method and approval rules.

### 3.2 Recommended Default Timing

| **Rule**           | **Default**                                       |
|--------------------|---------------------------------------------------|
| Season duration    | 1 January to 31 December                          |
| Registration       | Closes before Season starts                       |
| Verification grace | 48 hours after Season end                         |
| Majors             | Four configured windows spread through the Season |

## 4. League Joining, PINs & Registration

A player joins the overall Titan Season competition, not a specific division. Titan assigns the division after registration based on the rules below.

### 4.1 Default Join Method

> **6-DIGIT SEASON PIN + ADMIN APPROVAL**
>
> The organiser shares one Season PIN. A player enters the PIN, sees the Season details, requests entry and is admitted only after administrator approval.

```text
PLAYER ENTERS PIN
↓
SEASON FOUND
↓
PLAYER REVIEWS RULES
↓
REQUEST TO JOIN
↓
ADMIN APPROVES
↓
ENTRY HANDICAP SNAPSHOT CAPTURED
↓
PLAYER INCLUDED IN DIVISION BUILD
```

### 4.2 Join Channels

- 6-digit Season PIN.
- Shareable deep link.
- QR code that opens the same Season join flow.
- Optional future public/discoverable Season mode.

### 4.3 PIN Security

- PIN identifies the Season only; it must never grant administrator access.
- Player authentication is required before a join request can be submitted.
- Rate-limit failed PIN attempts.
- Admin can regenerate or disable the PIN.
- Registration deadline is enforced server-side.
- A player cannot create duplicate Season entries.

### 4.4 Join States

| **Rule**         | **Default**                                                       |
|------------------|-------------------------------------------------------------------|
| PENDING_APPROVAL | Player has requested entry.                                       |
| APPROVED         | Player accepted into Season.                                      |
| DECLINED         | Admin rejected the request.                                       |
| WAITLISTED       | Optional state if league capacity rules require it.               |
| NEXT_SEASON      | Registration is closed; player can be queued for the next Season. |

## 5. Division Structure & Initial Placement

The default pyramid is Premier League, Championship, League One, League Two and additional divisions as required. Division names, order, size and movement places are configurable.

### 5.1 Recommended Division Size

> **DEFAULT TARGET: 20 PLAYERS**
>
> Division size is configurable. Titan should fill divisions as evenly as practical after registration closes.

### 5.2 First-Season Placement

1.  Take every approved player.

2.  Use the player's Season Entry Handicap snapshot.

3.  Sort players from lowest Handicap Index to highest.

4.  Fill the Premier League first to its target size.

5.  Fill the Championship next.

6.  Continue through the pyramid.

7.  Generate an administrator preview before publication.

Do not use rigid handicap bands unless an administrator explicitly chooses that alternative. Ranking the full entry list produces balanced league sizes.

### 5.3 Mid-Season Handicap Changes

> **NO MID-SEASON DIVISION MOVES**
>
> A player's Handicap Index may change throughout the year. New rounds use the appropriate current handicap snapshot, but the player remains in the same division until Season close.

## 6. Promotion, Relegation & Future Seasons

### 6.1 Default Movement

| **Rule**         | **Default**                         |
|------------------|-------------------------------------|
| Premier League   | No promotion; bottom 3 relegated.   |
| Middle divisions | Top 3 promoted; bottom 3 relegated. |
| Bottom division  | Top 3 promoted; no relegation.      |

There are no promotion playoffs in V1. Promotion is automatic from final league position.

### 6.2 Qualification and Promotion

A player must be Qualified at Season close to win a division or be promoted. DNQ players cannot take a promotion place.

### 6.3 Relegation and DNQ

A DNQ player can be relegated. Final relegation rules must be deterministic when DNQ players occupy lower positions; Titan should rank qualified players for awards/promotion while still retaining DNQ players in the final table.

### 6.4 Next-Season Assignment

8.  Lock the final Season table.

9.  Mark champions.

10. Apply promotions.

11. Apply relegations.

12. Create next-season provisional division assignments.

13. Add new entrants according to the configured new-player policy.

14. Present an admin preview.

15. Publish the next Season divisions.

## 7. Player & Round Eligibility

### 7.1 Default Qualifying Round Requirements

- 18 completed holes.
- Individual gross score recorded on every hole.
- Minimum 2-ball.
- At least one playing partner identifiable as a Titan user.
- At least one partner verifies the submitted score.
- Approved course, layout and tee.
- Valid Par and Stroke Index for all 18 holes.
- Valid handicap snapshot and calculated Season Playing Handicap.
- Round started/played within the Season window.
- Round is not a simulator/practice-only round unless a future Season specifically permits it.

### 7.2 Group Rule

| **Rule** | **Default**  |
|----------|--------------|
| Solo     | Not eligible |
| 2-ball   | Eligible     |
| 3-ball   | Eligible     |
| 4-ball   | Eligible     |

### 7.3 Round Statuses

```text
DRAFT
STARTED
SUBMITTED
AWAITING_VERIFICATION
VERIFIED
SCORED
DISPUTED
REJECTED
VOID
LOCKED
```

## 8. Stableford Calculation Rules

Titan Season V1 uses individual Stableford. The app stores gross scores and calculates Stableford server-side from the player's Season Playing Handicap and the hole Stroke Index.

### 8.1 Default Handicap Allowance

> **TITAN V1 DEFAULT: 100% OF CALCULATED COURSE HANDICAP**
>
> This default keeps the core Season concept simple: 36 Stableford points represents playing to handicap. The allowance must be a versioned configuration value so Titan can use a different competition allowance in future without changing historical seasons.

### 8.2 Handicap Snapshots

- Store Handicap Index snapshot for the round.
- Store course/tee rating data snapshot or immutable reference/version.
- Store calculated Course Handicap.
- Store Season handicap allowance percentage.
- Store final Season Playing Handicap used for Stroke Index allocation.
- Historical rounds never recalculate because a player's later Handicap Index changes.

### 8.3 Hole Stableford

| **Net hole result**       | **Stableford points** |
|---------------------------|-----------------------|
| Net double bogey or worse | 0                     |
| Net bogey                 | 1                     |
| Net par                   | 2                     |
| Net birdie                | 3                     |
| Net eagle                 | 4                     |
| Net albatross             | 5                     |
| Net 4 under par           | 6                     |

### 8.4 Stroke Allocation

Playing Handicap strokes are allocated using hole Stroke Index. If Playing Handicap exceeds 18, a second stroke is allocated beginning again at Stroke Index 1. The calculation must support handicaps above 18 and negative/plus handicaps.

### 8.5 Plus Handicaps

The handicap service must support plus handicaps by removing strokes from the lowest Stroke Index priority holes according to the competition's configured handicap logic. This logic belongs in the Handicap Service, not in the Season scoring UI.

## 9. Titan Round Scoring Engine

The Titan Round Score is intentionally more engaging than raw Stableford while keeping Stableford as the fair core.

### 9.1 Recommended V1 Formula

```text
Titan Round Points
= Stableford Total
+ Stableford Performance Bonus
+ Gross Achievement Bonus

If Major-eligible:
Final Round Points = round_half_up(Titan Round Points × Major Multiplier)
```

### 9.2 Stableford Performance Bonus

| **18-hole Stableford Total** | **Performance Bonus** |
|------------------------------|-----------------------|
| 41 or more                   | +20                   |
| 40                           | +18                   |
| 39                           | +16                   |
| 38                           | +14                   |
| 37                           | +12                   |
| 36                           | +10                   |
| 35                           | +8                    |
| 34                           | +6                    |
| 33                           | +4                    |
| 32                           | +2                    |
| 31 or fewer                  | 0                     |

### 9.3 Gross Achievement Bonus

| **Gross achievement** | **Default bonus**        |
|-----------------------|--------------------------|
| Albatross or better   | +20                      |
| Eagle                 | +10                      |
| Birdie                | +5                       |
| Gross par             | 0 additional             |
| Gross bogey           | 0 additional             |
| Gross double or worse | 0 additional             |
| Hole-in-one           | +10 additional HIO bonus |

> **WHY NO +5 PAR / -2 BOGEY?**
>
> The Stableford total already scores each hole relative to handicap. A second large par/bogey scoring layer would double-count hole performance and skew the league toward golfers who make more gross pars. Birdie/eagle bonuses remain because they are exceptional gross achievements and add the Titan 'highlight' element.

### 9.4 Scoring Profile Must Be Configurable

All values above are Season configuration, not hard-coded app constants. Once a Season starts, its scoring profile is locked/versioned.

```json
{
"format": "stableford",
"handicap_allowance_percent": 100,
"performance_bonus": {"31_or_less":0,"32":2,"33":4,"34":6,"35":8,"36":10,"37":12,"38":14,"39":16,"40":18,"41_plus":20},
"gross_bonus": {"birdie":5,"eagle":10,"albatross_or_better":20,"hole_in_one_extra":10},
"round_floor": 0,
"major_multiplier": 1.5
}
```

## 10. Best 20 System

Players may submit unlimited qualifying rounds. Titan automatically chooses the 20 highest Final Round Points.

### 10.1 Qualification

| **Rule**               | **Default** |
|------------------------|-------------|
| 0-19 qualifying rounds | PROVISIONAL |
| 20+ qualifying rounds  | QUALIFIED   |

### 10.2 Best 20 Algorithm

16. Retrieve all VERIFIED/SCORED qualifying rounds for the player.

17. Ensure Major reassignment has already been resolved.

18. Sort by Final Round Points descending.

19. Use deterministic round-level tiebreak order if equal.

20. Mark the first 20 as counting.

21. Mark all remaining rounds non-counting.

22. Sum the 20 counting scores to Season Points.

23. Store the current lowest counting score as Next Score To Beat.

### 10.3 Player Feedback

```text
NEW COUNTING SCORE

Latest round: 62
Previous lowest counting score: 47
Season improvement: +15
New Season Points: 1,184
```

## 11. Titan Majors

Each Season contains four configurable Majors.

### 11.1 Major Configuration

- Name.
- Sequence 1-4.
- Start timestamp.
- End timestamp.
- Season timezone.
- Multiplier (default 1.5×).
- Description/image metadata.
- Status.

### 11.2 One Multiplied Round per Major

24. A player may play multiple qualifying rounds during a Major window.

25. Titan compares the player's eligible Base Titan Round Points inside that Major.

26. Only the player's highest Base Titan Round Points receives the Major multiplier.

27. Other rounds remain normal Season rounds.

28. If a later verified round is better, Titan automatically reassigns the Major multiplier.

29. Best 20 and league standings are recalculated automatically.

### 11.3 Major Leaderboard

Each Major has its own leaderboard. The winner is the player with the highest Final Major Round Points after the Major window and verification grace have closed.

### 11.4 Recommended Major Branding

| **Rule** | **Default**               |
|----------|---------------------------|
| Major 1  | Titan Masters             |
| Major 2  | Titan Championship        |
| Major 3  | Titan Open                |
| Major 4  | Titan Season Championship |

## 12. Score Verification & Anti-Cheating

### 12.1 Verification Flow

```text
PLAYER SUBMITS ROUND
↓
PARTNER RECEIVES VERIFICATION REQUEST
↓
VERIFY or DISPUTE
↓
IF VERIFIED: SCORING ENGINE RUNS
↓
BEST 20 + LEAGUE + EVENTS RECALCULATE
```

### 12.2 Edit After Verification

> **ANY SCORE EDIT INVALIDATES THE VERIFICATION**
>
> If a hole score, tee, handicap snapshot or other scoring input changes after verification, the round returns to AWAITING_VERIFICATION and must be verified again.

### 12.3 Disputes

- Verifier can dispute a submitted round.
- Disputed rounds do not count.
- Admin can confirm, amend, reject or void.
- Any admin edit creates an audit record with old value, new value, reason, actor and timestamp.

### 12.4 Locked Rounds

Once the round is verified, scoring is final and any configured dispute period has passed, the round may enter LOCKED state. Players cannot alter a locked round. Admin reopening requires a reason and audit event.

## 13. League Tables, Qualification & Tiebreakers

### 13.1 Football-Style Table

| **Pos** | **Player**  | **Played** | **Counting** | **Season Pts** | **Status** |
|---------|-------------|------------|--------------|----------------|------------|
| 1       | Ricky Snell | 34         | 20           | 1,246          | Champion   |
| 2       | Player B    | 30         | 20           | 1,221          | Promotion  |
| 3       | Player C    | 29         | 20           | 1,198          | Promotion  |
| 4       | Player D    | 33         | 20           | 1,177          | Safe       |
| 18      | Player R    | 25         | 20           | 894            | Relegation |
| 19      | Player S    | 31         | 20           | 873            | Relegation |
| 20      | Player T    | 22         | 20           | 841            | Relegation |

### 13.2 Qualification Display

- Players appear in the live table from their first qualifying round.
- Before 20 rounds they are marked PROVISIONAL.
- At 20 verified qualifying rounds they become QUALIFIED.
- At Season close a non-qualified player is marked DNQ.

### 13.3 Season Tiebreakers

30. Compare highest counting round.

31. If tied, compare second-highest counting round.

32. Continue through all 20 counting rounds.

33. If still tied, compare 21st-best non-counting score, then 22nd etc when available.

34. If still tied, highest total Major Final Round Points.

35. If still tied, most gross birdies or better in counting rounds.

36. If still tied, player who first achieved the final tied Season Points total.

## 14. Existing Titan AI News Engine Integration

> **DO NOT BUILD A SECOND NEWS ENGINE**
>
> Titan Season Mode must publish structured, authoritative events to the existing Titan AI News Engine. Season Mode calculates the facts. The existing News Engine decides which facts become stories and creates the editorial content.

### 14.1 News-Relevant Season Events

| **Event**                   | **Event**                      | **Event**                      |
|-----------------------------|--------------------------------|--------------------------------|
| SEASON_STARTED              | PLAYER_JOINED_SEASON           | DIVISIONS_PUBLISHED            |
| ROUND_VERIFIED              | BEST_20_CHANGED                | NEW_SEASON_BEST_SCORE          |
| LEAGUE_POSITION_CHANGED     | PLAYER_TOOK_LEAGUE_LEAD        | PLAYER_ENTERED_PROMOTION_ZONE  |
| PLAYER_LEFT_PROMOTION_ZONE  | PLAYER_ENTERED_RELEGATION_ZONE | PLAYER_ESCAPED_RELEGATION_ZONE |
| PLAYER_QUALIFIED_20_ROUNDS  | MAJOR_ANNOUNCED                | MAJOR_STARTED                  |
| MAJOR_LEADER_CHANGED        | MAJOR_FINISHED                 | MAJOR_WINNER_CONFIRMED         |
| SEASON_TITLE_CLINCHED       | PROMOTION_CONFIRMED            | RELEGATION_CONFIRMED           |
| DIVISION_CHAMPION_CONFIRMED | SEASON_FINISHED                |                                |

### 14.2 News Event Payload

```text
event_id
event_type
importance: LOW | NORMAL | HIGH | BREAKING
season_id
division_id
player_id / affected_player_ids
old_position / new_position
old_season_points / new_season_points
round_id / course / round_points
best20_change
promotion_relegation_context
major_context
occurred_at
facts_version
```

### 14.3 News Processing Order

```text
ROUND VERIFIED
↓
ROUND SCORED
↓
MAJOR ASSIGNMENT RESOLVED
↓
BEST 20 RECALCULATED
↓
LEAGUE RECALCULATED
↓
SEASON EVENTS CREATED
↓
EXISTING TITAN AI NEWS ENGINE
```

### 14.4 News Integrity

- News Engine receives calculated facts; it must not calculate league positions or Season Points itself.
- Each event has a unique id to prevent duplicate stories after a recalculation.
- If a round is corrected/voided and a previous story becomes wrong, Season Mode publishes a correction-impact event.
- No invented quotes or fabricated player statements are required from Season Mode.

## 15. Notifications & Player Engagement

| **Rule**        | **Default**                                     |
|-----------------|-------------------------------------------------|
| Verification    | Your round is waiting for partner verification. |
| Counting score  | Your latest round entered your Best 20.         |
| Position move   | You moved from 6th to 4th.                      |
| Promotion       | You are now in the promotion places.            |
| Relegation      | You are 8 points above the relegation zone.     |
| Qualification   | You have completed 20/20 qualifying rounds.     |
| Major countdown | Titan Open starts in 3 days.                    |
| Major result    | Your Major score is now 96.                     |
| Season result   | Promotion / relegation / champion confirmed.    |

### 15.1 Next Score To Beat

After a player has 20 counting rounds, the dashboard must prominently display the lowest current counting score. This becomes the immediate target for every future round.

## 16. Player UX & Required Screens

### 16.1 Season Home

```text
TITAN PREMIER LEAGUE

Position: 4th
Season Points: 1,184
Rounds Played: 31
Counting: 20 / 20
Next Score To Beat: 47
Status: SAFE
Next Major: TITAN OPEN – 6 DAYS
```

### 16.2 Required Navigation

| **Rule**  | **Default**                                                     |
|-----------|-----------------------------------------------------------------|
| Overview  | Position, points, qualification, status, next target.           |
| Table     | Full football-style division table.                             |
| My Rounds | All qualifying/non-counting/pending rounds.                     |
| Best 20   | Current counting scores and score to beat.                      |
| Majors    | Major calendar, results and leaderboards.                       |
| News      | Existing Titan news filtered to Season/division/player context. |
| History   | Previous seasons, promotions, relegations, titles.              |

### 16.3 Round Start / Entry

37. Select Play Titan Season Round.

38. Select course, layout and tee.

39. Titan shows Par, Rating, Slope, Handicap Index and calculated Season Playing Handicap.

40. Select playing partner(s).

41. Record gross scores hole-by-hole.

42. Show provisional Stableford/Titan score during entry if desired.

43. Submit.

44. Partner verifies.

45. Server calculates final result and league impact.

### 16.4 Post-Round Impact Screen

```text
ROUND VERIFIED

Stableford: 38
Performance Bonus: +14
Gross Achievement Bonus: +5
Titan Round Points: 57

Entered Best 20: YES
Score dropped: 44
Season improvement: +13
New position: 4th (▲2)
```

## 17. Admin Control Panel

### 17.1 Season Setup

- Create/edit Season while DRAFT.
- Dates and timezone.
- Registration rules.
- Join PIN / regenerate / disable.
- Division names/order/sizes.
- Promotion/relegation places.
- Qualification and Best-X settings.
- Stableford handicap allowance.
- Titan scoring profile.
- Four Majors.

### 17.2 Player Management

- Approve/decline join requests.
- View Season Entry Handicap.
- Preview division assignment.
- Manual override before publication with audit reason.
- Remove/withdraw player.
- Mark special entry status if required.

### 17.3 Round Management

- Search/view round.
- Inspect hole-by-hole score.
- View verifier and verification version.
- Resolve dispute.
- Correct data with audit trail.
- Void/reinstate with reason.

### 17.4 Season Close Preview

- Final table preview.
- DNQ list.
- Champion preview.
- Promotions/relegations.
- Major winners.
- Outstanding verification/disputes.
- Next-season provisional division assignments.

## 18. Data Model

### 18.1 Season

```text
season_id
name
season_year
timezone
registration_open_at
registration_close_at
start_at
end_at
verification_grace_minutes
minimum_qualifying_rounds
counting_round_limit
status
scoring_profile_id
handicap_profile_id
join_policy_id
created_at
locked_at
```

### 18.2 Division

```text
division_id
season_id
name
display_order
target_player_count
promotion_places
relegation_places
status
```

### 18.3 Season Entry

```text
season_entry_id
season_id
division_id
player_id
entry_handicap_index
join_status
qualification_status
qualifying_rounds_count
counting_rounds_count
season_points
current_position
previous_position
movement_status
created_at
```

### 18.4 Round

```text
round_id
season_id
season_entry_id
course_id
layout_id
tee_id
played_at
submitted_at
verified_at
handicap_index_snapshot
course_handicap_snapshot
handicap_allowance_percent
playing_handicap_snapshot
stableford_total
performance_bonus
gross_achievement_bonus
base_titan_round_points
major_id
major_multiplier
final_round_points
status
is_qualifying
is_counting
score_version
scoring_rules_version
```

### 18.5 Hole Score

```text
hole_score_id
round_id
hole_number
par
stroke_index
gross_score
handicap_strokes_received
net_score
net_relative_to_par
stableford_points
gross_relative_to_par
gross_achievement_type
gross_bonus_points
```

### 18.6 Major

```text
major_id
season_id
sequence
name
start_at
end_at
multiplier
status
image_ref
description
```

### 18.7 Verification

```text
verification_id
round_id
verifier_player_id
score_version
status
verified_at
dispute_reason
```

### 18.8 Join Request

```text
join_request_id
season_id
player_id
join_token_or_pin_reference
status
requested_at
decided_at
decided_by
```

## 19. Services & Backend Architecture

| **Service**          | **Responsibility**                                     |
|----------------------|--------------------------------------------------------|
| Season Service       | Season lifecycle and configuration.                    |
| Join Service         | PIN/deep-link/QR join requests and approval.           |
| Division Service     | Initial placement and next-season assignment.          |
| Handicap Service     | Course/Playing Handicap and stroke allocation.         |
| Round Service        | Round lifecycle and raw score storage.                 |
| Verification Service | Partner verification and score-version validity.       |
| Stableford Service   | Hole and 18-hole Stableford calculation.               |
| Titan Scoring Engine | Performance/gross bonuses and final round points.      |
| Major Service        | Major eligibility, reassignment and Major leaderboard. |
| Best20 Service       | Counting-round selection and Season Points.            |
| Leaderboard Service  | League ranking, gaps and status zones.                 |
| Movement Service     | Promotion/relegation/next-season assignment.           |
| Event Service        | Authoritative Season events for news/notifications.    |
| Notification Service | Player alerts.                                         |
| History Service      | Locked Season history and trophy records.              |

### 19.1 Server Authority

> **THE CLIENT IS NEVER AUTHORITATIVE FOR SEASON RESULTS**
>
> Mobile/web clients may show provisional calculations, but official Stableford, Titan Round Points, Best 20, Major assignment, league position, promotion and relegation are calculated server-side.

## 20. Event Model & Recalculation

### 20.1 Core Events

| **Event**            | **Event**                      | **Event**                 |
|----------------------|--------------------------------|---------------------------|
| SEASON_CREATED       | REGISTRATION_OPENED            | JOIN_REQUESTED            |
| PLAYER_APPROVED      | DIVISIONS_PUBLISHED            | SEASON_STARTED            |
| ROUND_STARTED        | ROUND_SUBMITTED                | ROUND_VERIFIED            |
| ROUND_DISPUTED       | ROUND_VOIDED                   | ROUND_SCORED              |
| MAJOR_ROUND_ASSIGNED | BEST_20_CHANGED                | LEAGUE_POSITION_CHANGED   |
| PLAYER_QUALIFIED     | PROMOTION_STATUS_CHANGED       | RELEGATION_STATUS_CHANGED |
| MAJOR_STARTED        | MAJOR_FINISHED                 | SEASON_ENDED              |
| SEASON_LOCKED        | CHAMPION_CONFIRMED             | PLAYER_PROMOTED           |
| PLAYER_RELEGATED     | NEXT_SEASON_ASSIGNMENT_CREATED |                           |

### 20.2 Recalculation Must Be Idempotent

Running the same calculation repeatedly against the same source data must produce the same final result and must not create duplicate news/notification events.

### 20.3 Calculation Dependency Order

```text
VALIDATE RAW ROUND
→ CALCULATE HANDICAP/STROKES
→ CALCULATE HOLE STABLEFORD
→ CALCULATE 18-HOLE STABLEFORD
→ CALCULATE TITAN BONUSES
→ RESOLVE MAJOR ROUND
→ CALCULATE FINAL ROUND POINTS
→ RECALCULATE BEST 20
→ RECALCULATE LEAGUE
→ CALCULATE ZONE/STATUS CHANGES
→ EMIT EVENTS
→ NEWS + NOTIFICATIONS
```

## 21. Season Close & Rollover

### 21.1 Automatic Close

46. At Season end, prevent new Season rounds from starting.

47. Move Season into VERIFICATION_GRACE.

48. Allow rounds played before end time to be verified within the configured grace period.

49. Resolve outstanding Major reassignment.

50. Recalculate every Best 20.

51. Apply qualification status.

52. Produce final league tables.

53. Apply tiebreakers.

54. Confirm champions.

55. Confirm promotions and relegations.

56. Emit final Season events to the existing News Engine.

57. Lock scoring inputs/results.

58. Create next-season provisional assignments.

### 21.2 Historical Integrity

- Previous Season Points remain permanently reproducible.
- Previous scoring profiles remain versioned and immutable.
- Historical handicap snapshots are retained.
- Promotion/relegation history is permanent.
- Major winners and division champions feed the player's trophy/history views.

## 22. Edge Cases & Failure Conditions

| **Scenario**                            | **Required behaviour**                                    |
|-----------------------------------------|-----------------------------------------------------------|
| Solo round                              | Reject as Season qualifier.                               |
| 17 holes only                           | Reject / incomplete.                                      |
| Missing gross score                     | Reject / incomplete.                                      |
| Unknown tee or incomplete tee data      | Cannot start/submit qualifying round.                     |
| No Stroke Index                         | Cannot calculate Stableford; reject until corrected.      |
| No handicap snapshot                    | Cannot score; hold in error state.                        |
| Partner refuses verification            | Round remains non-counting.                               |
| Partner disputes                        | DISPUTED; admin resolution required.                      |
| Score edited after verification         | Verification invalidated; reverify.                       |
| Round after Season end                  | Not Season eligible.                                      |
| Round before end, verified during grace | Eligible.                                                 |
| Major better round arrives later        | Reassign multiplier and recalculate.                      |
| Admin voids a counting round            | Rebuild Best 20 and league automatically.                 |
| Player has 19 rounds at close           | DNQ.                                                      |
| Player changes handicap                 | New rounds use new snapshot; division unchanged.          |
| Scoring rules changed for future Season | Historical Season unaffected.                             |
| Duplicate event processing              | No duplicate story/notification due to event idempotency. |

## 23. Acceptance Tests

| **Test**                | **Expected Result**                                                                            | **Pass Criteria**            |
|-------------------------|------------------------------------------------------------------------------------------------|------------------------------|
| Join PIN                | Valid PIN creates join request; wrong PIN does not expose Season data beyond safe error state. | Automated + integration test |
| Admin approval          | Player is not entered into division build until approved.                                      | Automated + integration test |
| Division seeding        | Approved players sort by Entry Handicap and fill divisions in correct order.                   | Automated + integration test |
| No mid-season move      | Handicap change does not move division.                                                        | Automated + integration test |
| Solo round              | Not eligible.                                                                                  | Automated + integration test |
| 2-ball verified         | Eligible and scores after partner verification.                                                | Automated + integration test |
| Stableford 36           | Performance Bonus = +10.                                                                       | Automated + integration test |
| Stableford 40           | Performance Bonus = +18.                                                                       | Automated + integration test |
| Gross birdie            | Default gross bonus = +5.                                                                      | Automated + integration test |
| Gross eagle             | Default gross bonus = +10.                                                                     | Automated + integration test |
| HIO                     | Apply relative-to-par bonus plus +10 HIO extra.                                                | Automated + integration test |
| Best 20                 | 21st better score replaces lowest counting score.                                              | Automated + integration test |
| Non-counting            | Lower new score remains stored but Season Points unchanged.                                    | Automated + integration test |
| Major 1.5×              | Base Titan Round Points multiplied and rounded half-up.                                        | Automated + integration test |
| Multiple Major rounds   | Highest Base Titan score receives multiplier automatically.                                    | Automated + integration test |
| Later Major improvement | Multiplier moves to better round and all affected totals recalc.                               | Automated + integration test |
| Verification edit       | Any scoring input edit invalidates old verification.                                           | Automated + integration test |
| DNQ                     | 19 rounds cannot win/promote.                                                                  | Automated + integration test |
| Promotion               | Top 3 qualified players move up by default.                                                    | Automated + integration test |
| Relegation              | Bottom 3 move down by default.                                                                 | Automated + integration test |
| Tiebreak                | Counting scores compared in deterministic order.                                               | Automated + integration test |
| News event              | League change emits one structured event after authoritative recalculation.                    | Automated + integration test |
| Event retry             | Reprocessing same event does not duplicate story/notification.                                 | Automated + integration test |
| Historical rules        | Future config change does not alter old Season results.                                        | Automated + integration test |

## 24. Future Extensibility

- Team Season Mode.
- Private friend mini-leagues using the same Season scores.
- Club/regional/national pyramids.
- Scratch divisions.
- Seniors/women/junior categories where required.
- Knockout cup competitions.
- Champions League-style competition.
- Head-to-head fixtures.
- Promotion playoffs as an optional future rule.
- Order of Merit.
- Ryder Cup/Titan Tour qualification.
- Sponsored Majors.
- Season achievements and badges.
- Global rankings.
- Alternative counting limits (Best 10, Best 15, Best 25).
- Alternative scoring profiles without changing historical seasons.

## Appendix A. Default Configuration

| **Setting**           | **Default**                   | **Configurable?**                       |
|-----------------------|-------------------------------|-----------------------------------------|
| Core format           | Individual Stableford         | Yes, future                             |
| Handicap allowance    | 100%                          | Yes                                     |
| Season duration       | Calendar year                 | Yes                                     |
| Minimum rounds        | 20                            | Yes                                     |
| Counting rounds       | Best 20                       | Yes                                     |
| Minimum group         | 2 players                     | Yes, but V1 minimum cannot be below 2   |
| Partner verification  | Required                      | Yes by Season policy                    |
| Division target size  | 20                            | Yes                                     |
| Promotion places      | 3                             | Yes                                     |
| Relegation places     | 3                             | Yes                                     |
| Majors                | 4                             | V1 fixed at 4; names/dates configurable |
| Major multiplier      | 1.5×                          | Yes                                     |
| Join PIN              | 6 digits                      | Yes within supported policy             |
| Join approval         | Admin approval                | Yes                                     |
| Stableford 36 bonus   | +10                           | Yes via scoring profile                 |
| Birdie gross bonus    | +5                            | Yes                                     |
| Eagle gross bonus     | +10                           | Yes                                     |
| Albatross gross bonus | +20                           | Yes                                     |
| Hole-in-one extra     | +10                           | Yes                                     |
| Par/bogey extra       | 0                             | Yes                                     |
| News                  | Existing Titan AI News Engine | Integration required                    |

## Appendix B. Worked Scoring Examples

### Example 1 — Plays to Handicap

```text
Stableford Total: 36
Performance Bonus: +10
Gross birdies: 1 × +5 = +5
Other gross bonuses: 0

Titan Round Points = 36 + 10 + 5 = 51
```

### Example 2 — Strong Round

```text
Stableford Total: 40
Performance Bonus: +18
Gross birdies: 2 × +5 = +10
Gross eagle: 1 × +10 = +10

Titan Round Points = 40 + 18 + 10 + 10 = 78
```

### Example 3 — Major

```text
Base Titan Round Points: 78
Major multiplier: 1.5×
78 × 1.5 = 117

Final Round Points = 117
```

### Example 4 — Best 20 Replacement

```text
Current Season Points: 1,082
Lowest counting round: 43
New verified round: 61

61 replaces 43
Season improvement = +18
New Season Points = 1,100
```

### Example 5 — Major Reassignment

```text
Friday Base Score: 55
Saturday Base Score: 68
Sunday Base Score: 62

Saturday is the Major round.
68 × 1.5 = 102
Friday and Sunday remain normal qualifying rounds.
```

## Titan Season Mode — V1 Final Rules Snapshot

| **Rule**                   | **Default**                                              |
|----------------------------|----------------------------------------------------------|
| Competition                | Year-long football-style golf league pyramid             |
| Format                     | Individual Stableford                                    |
| Rounds                     | Unlimited                                                |
| Counting                   | Best 20                                                  |
| Qualification              | Minimum 20 verified qualifying rounds                    |
| Minimum group              | 2-ball                                                   |
| Verification               | Playing partner required                                 |
| Initial division           | Handicap-ranked seeding                                  |
| Mid-season handicap change | No division move                                         |
| Promotion                  | Top 3 automatically                                      |
| Relegation                 | Bottom 3 automatically                                   |
| Majors                     | 4, default 1.5×                                          |
| Scoring                    | Stableford + Performance Bonus + Gross Achievement Bonus |
| 36 Stableford              | +10 Performance Bonus                                    |
| Joining                    | Season PIN + admin approval                              |
| News                       | Existing Titan AI News Engine integration                |
| Season close               | Automatic calculation, movement and rollover             |

**PLAY ALL YEAR. BEST 20 COUNT. CLIMB THE LEAGUES.**

**SURVIVE RELEGATION. CHASE PROMOTION. WIN THE MAJORS. BECOME TITAN SEASON CHAMPION.**

---

*Titan Golf App • Season Mode v1.0 • Build-ready specification*
