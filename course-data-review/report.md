# England course master (533) — reconciliation against live DB

Source: `screenshots/TITAN_ENGLAND_MASTER_DATABASE_READY_533 (1).xlsx`. Live DB read via service-role key, read-only — nothing has been written.

## Headline counts (533 master course/layout records)

| Status | Count | Meaning |
|---|---|---|
| `match_clean` | 327 | Name matched an existing DB course; every tee/hole field already agrees. Nothing to do. |
| `match_with_diffs` | 91 | Name matched; some tee/hole numeric fields (rating, slope, par, yardage, SI) differ — safe to auto-correct. |
| `needs_review` | 105 | Name matched, but at least one master tee has no clean (tee_name, gender) match among the DB's tees for that course — could be a rename, a missing gender split, or a genuinely new tee. **Not auto-fixable — needs a human call.** |
| `new` | 10 | No matching course found in the DB at all — needs adding from scratch. |

Matching itself was clean: all 523 matched courses matched by an **exact** "Official Course Name" == DB `name` string match — no fuzzy matching or ambiguous cases were needed anywhere.

## The one real pattern worth understanding: `needs_review`

Almost all 105 `needs_review` courses share the same shape, e.g. **Silvermere Golf Club**:

- Master has: White (M), Red (F)
- DB has: White (gender `''`), Yellow (M), Red (M)

Two different things are tangled together here:
1. The DB's "Red" tee is currently tagged gender **M**, but the master says it should be **F** — a real mislabeling that would give the wrong WHS playing handicap to women using it.
2. The DB's "White" tee is unisex (`''`), while the master wants a **male-specific** rating for White — meaning the DB may be missing a proper gender split rather than just being wrong.

I did not attempt to auto-resolve these — renaming/splitting a tee risks corrupting real historical scores tied to that tee_name, and the master file's own "no-guessing rule" argues for the same caution here. Every such case is listed with its exact master-vs-DB tee list in `full_report.json` (filter for `"status": "needs_review"`) so you (or Rick) can eyeball each club's actual scorecard and decide: rename, add a second gender row, or leave as-is.

## Safe corrections (`amendments.sql`)

262 tee-level field corrections + 1,502 hole-level field corrections across 114 courses, all pure `UPDATE ... SET field = value WHERE course_name = ... AND tee_name = ... AND gender = ...` on rows that already matched cleanly by name + gender. Review before running — generated, not hand-checked per row — but the matching logic behind them is exact-key, not fuzzy.

## New courses (`new-courses.sql`)

10 courses genuinely absent from the DB (double-checked they don't exist under any near-variant name):

- Close House – Lee Westwood Colt Course (Northumberland)
- Close House Golf Club – Filly Course (Northumberland)
- Boston Golf Club (Lincolnshire)
- Royal Lytham & St Annes Golf Club (Lancashire)
- Formby Golf Club (Merseyside)
- Royal Liverpool Golf Club (Merseyside)
- Royal West Norfolk Golf Club (Norfolk)
- Royal Blackheath Golf Club (Greater London)
- Hainault Golf Club – London Course (Greater London)
- Hainault Golf Club – Old Course (Greater London)

The SQL inserts `courses`, `course_tees`, and `course_tee_holes` rows for every tee the master has for these. It also derives one `course_holes` (the legacy GPS/rangefinder par table) row set per course from a single canonical tee — the first male/unisex tee in the master's own row order. **That canonical-tee choice is a judgment call, not a verified default** — worth a glance before running, especially for any of these with a genuine gender split (par can differ M vs F on some holes).

## Side note, outside this master file's scope

`North Oxford Golf Club` still exists in the live `courses` table, but the master's "Removed Invalid Configs" sheet says it closed permanently on 2025-10-31 and deliberately excludes it. Not touched here — deleting it could break historical rounds/handicap history tied to it — but flagging so you can decide whether to mark it closed/hidden in the app rather than fully remove it.
