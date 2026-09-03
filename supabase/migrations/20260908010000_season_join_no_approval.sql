-- Titan Season Mode — the approval gate is gone (Dave, 2026-09-08: "we dont
-- need an approval, if they have the code, it was given by us"). Holding the
-- 6-digit Season PIN IS the authorization, because the admin is the one who
-- handed it out, so season/join.tsx now writes a season_entries row directly
-- and never creates a season_join_requests row.
--
-- Nothing is dropped here on purpose: seasons.join_requires_approval and the
-- whole season_join_requests table stay exactly as they are (backwards
-- compatible, no data loss) — the app simply stops routing joins through
-- them. This migration's only job is to unblock the people who are ALREADY
-- stuck in the pending state and would otherwise never get let in, since the
-- admin approval screen no longer has a way in.
--
-- Both statements are idempotent and safe to re-run.

-- 1. Every currently-pending join request becomes a real, approved entry.
--    Column list mirrors exactly what admin/season-requests.tsx's approve path
--    used to insert: entry_handicap_index is the player's handicap snapshot at
--    approval time, join_status 'approved', qualification_status 'provisional'.
--    division_id stays NULL — same as any other new entry, it gets filled in
--    when the admin publishes divisions (src/lib/seasonDivisions.ts).
--    LEFT JOIN so a player row that somehow can't be read still gets an entry
--    with a NULL handicap rather than being silently skipped.
--    ON CONFLICT targets season_entries' UNIQUE (season_id, player_id).
INSERT INTO season_entries (season_id, player_id, entry_handicap_index, join_status, qualification_status)
SELECT r.season_id, r.player_id, p.handicap_index, 'approved', 'provisional'
FROM season_join_requests r
LEFT JOIN players p ON p.id = r.player_id
WHERE r.status = 'pending_approval'
ON CONFLICT (season_id, player_id) DO NOTHING;

-- 2. Close those requests so no stale "pending" banner or badge survives.
--    decided_by is left NULL deliberately — no admin made this decision, the
--    rule changed underneath them.
UPDATE season_join_requests
SET status = 'approved', decided_at = NOW()
WHERE status = 'pending_approval';

-- 3. Safety net: any season_entries row still sitting at the table's default
--    join_status of 'pending_approval' is invisible to the division builder
--    (seasonDivisions.ts filters on join_status = 'approved'), which would
--    leave that player entered but never placed. With approval removed there
--    is no such thing as a pending entry any more.
UPDATE season_entries
SET join_status = 'approved'
WHERE join_status = 'pending_approval';
