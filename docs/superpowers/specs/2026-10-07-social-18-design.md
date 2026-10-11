# Social 18 — Design

Date: 2026-10-07. Status: draft for Dave's review. Mobile only (iOS + Android parity).

## What it is
A single-day golf gathering. A host announces it, builds it, invites people, they accept or decline, accepted players sit in a waiting room, and on the day the host builds groups/teams from the accepted players and the existing game mechanics run the round. No multi-day, no divisions, no points system, no handicap cuts — "it is just golf".

Origin: Rick was faking this with a Swindle called "MASHIE social 18" (Swindle has money + groups but no invites or waiting room).

## Non-goals (v1)
Multi-day events, handicap divisions, tournament points, handicap cuts, web builder, new scoring formats.

## Screens
1. **Home**: a red "Social 18" button (reuses the existing home tile/quick-button pattern, red accent). Opens the Social 18 hub.
2. **Hub**: upcoming Social 18s for the player's current society (hosting + invited + joined), and a **Social 18 Create** button.
3. **Create** (one page, host only): name, date, tee time, course (existing course picker), entry fee, money method (one collector / pay winners at the end / no money), prize places (1st/2nd/3rd split), invitees (existing society player picker), and a "Post to society chat" switch (default on).
4. **Event page**, role-dependent:
   - Host: Edit, Invite more, Remove player, Start the day, Cancel event, plus Mark Paid on the money card.
   - Invitee/joiner: read-only **waiting room** — details, who's in / pending, money rules. No edit controls. Declined players are not listed.
   - On the day: both see the event chat and a link into the live Game Day.
5. **Start the day** (host): opens the existing game builder (`games/new` + `GroupBuilderSheet`) with accepted players preloaded as the roster. Mashie four-ball teams use the "Team N" wording already fixed. Creates a normal Game Day.

## Invites, replies, chat
- Invite = DM card + push, same mechanism as tournament invites, new `message_type = 'social_invite'`; Accept/Decline in the inbox thread writes `social_event_players.status`.
- Host is told of every reply (DM + push), same behaviour as tournament invites (built 2026-10-07).
- Chat announcement: on create, a message in society chat (`channel = 'general'`) — "<Host> is playing Social 18 on <date> at <course>. Who wants in?" with an **I'm in** button. Tapping adds the player as `accepted`, source `chat`. Host can remove anyone.
- Event chat: opens for accepted players once created and stays through the day. Implemented as `messages.channel = 'social'` plus `messages.social_event_id`; `ChatChannel` gains an optional scope id so the existing component is reused.

## On the day
- Host presses Start the day → builder with accepted players → existing Game Day created, linked back to the event (`social_events.day_id`).
- Scoring, spectating, Stableford side game, leaderboard: existing code, unchanged.
- **Season**: Season ingestion already counts any completed casual round with real co-players, so a Social 18 Game Day counts automatically if players are in a season. No new code.

## Money
Entry fee + method + prize split live on `social_events`. Payments table (`social_event_players.paid`, `paid_at`). Wording is the clarified Swindle wording: "Entry fee · pay <collector>" up front; "Pay the winners" only once the event is complete. Winners come from the Game Day's Stableford results. No money flows in-app (tracking only), same as Swindle.

## Data (one migration, additive)
- `social_events`: id, society_id (NOT NULL), host_player_id, name, event_date, tee_time, course_name, entry_fee, currency, money_method (`collector`|`winners`|`none`), collector_player_id, prize_split (numeric[]), status (`open`|`started`|`complete`|`cancelled`), day_id (nullable FK to competition_days), created_at.
- `social_event_players`: id, event_id, player_id, status (`invited`|`accepted`|`declined`), source (`invite`|`chat`), paid, paid_at, unique(event_id, player_id).
- `direct_messages.message_type` CHECK += `social_invite`; add nullable `social_event_id`.
- `messages.channel` CHECK += `social`; add nullable `social_event_id`.
- RLS: society members can read events in their society; only the host writes events and removes players; a player writes only their own `social_event_players` row's status.
- All reads filter by `society_id` (cross-society leaks have bitten this app three times).

## Error handling
Create failures show an on-brand message, never a raw database error. A failed invite/notification never blocks the main action. Starting the day with fewer than 2 accepted players is blocked with a clear message.

## Testing
Typecheck + device pass: create → invite → accept/decline/"I'm in" → host sees replies → start day → score → money. Season check: a Social 18 round appears in a season entrant's rounds.

## Decisions already made with Dave
Standalone feature reusing existing mechanics; red button; host edits, invitees read-only; invited + chat "I'm in"; society chat announcement then per-event chat; single day only; season counts automatically.
