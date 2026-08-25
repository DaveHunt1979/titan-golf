#!/usr/bin/env python3
"""
Generate one additive Supabase migration from the unified course workbook +
the approved match_decisions.json.

- enrich_in_place courses: course_tees/course_tee_holes rows attached to the
  EXISTING live course_name string (course_holes/courses untouched).
- net-new courses: course_holes rows for one "primary" tee (prefer gender=M,
  then alphabetically first tee_name) to satisfy course_holes' single-value-
  per-hole shape, PLUS full course_tees/course_tee_holes coverage for every
  tee. The dead `courses` table (name/lat/lng, confirmed unread anywhere in
  the app) is intentionally left untouched — writing to it would add
  complexity for zero functional benefit.
- Ambiguous live courses (still in match_decisions.json's "ambiguous" list)
  get nothing written for them at all — they stay exactly as they are today.

Gender values in the source data include a literal "Not stated" string
(not just blank) — normalized here to '' (not NULL) so the UNIQUE/ON CONFLICT
target on (course_name, tee_name, gender) behaves correctly; Postgres treats
NULL as distinct-from-itself in unique constraints, which would silently
break idempotent re-runs.

Usage:
    python3 scripts/generate_migration.py
"""
import json
from collections import defaultdict
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
UNIFIED_PATH = ROOT / "screenshots" / "Golf courses" / "UK & Ireland" / "TITAN_GLOBAL_GOLF_COURSE_MASTER_UNIFIED.xlsx"
DECISIONS_PATH = ROOT / "scripts" / "match_decisions.json"
OUT_PATH = ROOT / "supabase" / "migrations" / "20260825010000_course_master_import.sql"

BATCH_SIZE = 300


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    if v is None or v == "":
        return "NULL"
    return str(v)


def norm_gender(g):
    return g if g in ("M", "F") else ""


def load_unified():
    wb = openpyxl.load_workbook(UNIFIED_PATH, data_only=True)

    def rows(sheet):
        ws = wb[sheet]
        r = list(ws.iter_rows(values_only=True))
        header = [str(h).strip() for h in r[0]]
        idx = {h: i for i, h in enumerate(header)}
        return [{h: row[idx[h]] for h in header} for row in r[1:] if row and any(v is not None for v in row)]

    courses = rows("Courses")
    tees = rows("Tee Ratings")
    holes = rows("Hole Data")

    courses_by_id = {c["Course ID"]: c for c in courses}
    tees_by_course = defaultdict(list)
    for t in tees:
        tees_by_course[t["Course ID"]].append(t)
    holes_by_course_tee = defaultdict(list)
    for h in holes:
        holes_by_course_tee[(h["Course ID"], h["Tee Name"], h["Gender"])].append(h)

    return courses_by_id, tees_by_course, holes_by_course_tee


def batched(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def main():
    courses_by_id, tees_by_course, holes_by_course_tee = load_unified()
    with open(DECISIONS_PATH) as f:
        decisions = json.load(f)

    enrich = decisions["enrich_in_place"]       # {live_course_name: course_id}
    net_new_ids = decisions["net_new_course_ids"]

    course_holes_rows = []   # (course_name, hole_number, par, stroke_index, yardage)
    course_tees_rows = []    # (course_name, tee_name, gender, par, distance, unit, cr, sr, source, rating_status, source_course_id)
    course_tee_holes_rows = []  # (course_name, tee_name, gender, hole_number, distance, par, stroke_index, source_course_id)

    def add_tees_and_holes(course_name, course_id):
        for t in tees_by_course.get(course_id, []):
            gender = norm_gender(t.get("Gender"))
            course_tees_rows.append((
                course_name, t.get("Tee Name"), gender, t.get("Par"), t.get("Total Distance"),
                t.get("Distance Unit"), t.get("Course Rating"), t.get("Slope Rating"),
                t.get("Source"), t.get("Rating Status"), course_id,
            ))
            for h in holes_by_course_tee.get((course_id, t.get("Tee Name"), t.get("Gender")), []):
                course_tee_holes_rows.append((
                    course_name, t.get("Tee Name"), gender, h.get("Hole"), h.get("Distance"),
                    h.get("Par"), h.get("Stroke Index"), course_id,
                ))

    # enrich_in_place: attach to the EXISTING live course_name, course_holes untouched.
    for live_name, course_id in enrich.items():
        add_tees_and_holes(live_name, course_id)

    # net-new: pick a primary tee (prefer gender=M, then alphabetical tee_name)
    # to populate course_holes; full tee/hole coverage still goes into the
    # new tables for every tee.
    for course_id in net_new_ids:
        c = courses_by_id[course_id]
        course_name = c["Official Course Name"]
        add_tees_and_holes(course_name, course_id)

        candidate_tees = tees_by_course.get(course_id, [])
        if not candidate_tees:
            continue
        primary = sorted(candidate_tees, key=lambda t: (t.get("Gender") != "M", str(t.get("Tee Name"))))[0]
        for h in holes_by_course_tee.get((course_id, primary.get("Tee Name"), primary.get("Gender")), []):
            course_holes_rows.append((
                course_name, h.get("Hole"), h.get("Par"), h.get("Stroke Index"), h.get("Distance"),
            ))

    lines = []
    lines.append("-- Course database import: additive tables (course_tees, course_tee_holes)")
    lines.append("-- plus course_holes rows for genuinely new courses only.")
    lines.append("-- Nothing existing is altered: enrich_in_place rows attach new tee/hole data")
    lines.append("-- to the EXISTING course_name string used across ~30 scoring/GPS/offline files;")
    lines.append("-- course_holes.par/stroke_index for the 41 live courses is never touched.")
    lines.append("")
    lines.append("""CREATE TABLE IF NOT EXISTS course_tees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_name      TEXT NOT NULL,
  tee_name         TEXT NOT NULL,
  gender           TEXT NOT NULL DEFAULT '' CHECK (gender IN ('M','F','')),
  par              INTEGER,
  total_distance   INTEGER,
  distance_unit    TEXT DEFAULT 'yd',
  course_rating    NUMERIC(4,1),
  slope_rating     INTEGER,
  source           TEXT,
  rating_status    TEXT,
  source_course_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_name, tee_name, gender)
);

CREATE TABLE IF NOT EXISTS course_tee_holes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_name      TEXT NOT NULL,
  tee_name         TEXT NOT NULL,
  gender           TEXT NOT NULL DEFAULT '' CHECK (gender IN ('M','F','')),
  hole_number      INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  distance         INTEGER,
  par              INTEGER NOT NULL CHECK (par BETWEEN 3 AND 5),
  stroke_index     INTEGER NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  source_course_id TEXT,
  UNIQUE (course_name, tee_name, gender, hole_number),
  FOREIGN KEY (course_name, tee_name, gender) REFERENCES course_tees (course_name, tee_name, gender) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_tees_course_name ON course_tees(course_name);
CREATE INDEX IF NOT EXISTS idx_course_tee_holes_course_name ON course_tee_holes(course_name);

ALTER TABLE course_tees ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_tee_holes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'course_tees' AND policyname = 'Auth read course tees') THEN
    CREATE POLICY "Auth read course tees" ON course_tees FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'course_tee_holes' AND policyname = 'Auth read course tee holes') THEN
    CREATE POLICY "Auth read course tee holes" ON course_tee_holes FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
""")

    lines.append(f"-- {len(course_tees_rows)} tee rows, {len(course_tee_holes_rows)} tee-hole rows, "
                  f"{len(course_holes_rows)} new course_holes rows ({len(net_new_ids)} net-new courses, "
                  f"{len(enrich)} existing courses enriched in place)")
    lines.append("")

    for batch in batched(course_tees_rows, BATCH_SIZE):
        values = ",\n".join(
            f"({sql_str(cn)}, {sql_str(tn)}, {sql_str(g)}, {sql_num(par)}, {sql_num(dist)}, "
            f"{sql_str(unit)}, {sql_num(cr)}, {sql_num(sr)}, {sql_str(src)}, {sql_str(rs)}, {sql_str(scid)})"
            for cn, tn, g, par, dist, unit, cr, sr, src, rs, scid in batch
        )
        lines.append(
            "INSERT INTO course_tees (course_name, tee_name, gender, par, total_distance, "
            "distance_unit, course_rating, slope_rating, source, rating_status, source_course_id) VALUES\n"
            + values + "\nON CONFLICT (course_name, tee_name, gender) DO NOTHING;\n"
        )

    for batch in batched(course_tee_holes_rows, BATCH_SIZE):
        values = ",\n".join(
            f"({sql_str(cn)}, {sql_str(tn)}, {sql_str(g)}, {sql_num(hn)}, {sql_num(dist)}, "
            f"{sql_num(par)}, {sql_num(si)}, {sql_str(scid)})"
            for cn, tn, g, hn, dist, par, si, scid in batch
        )
        lines.append(
            "INSERT INTO course_tee_holes (course_name, tee_name, gender, hole_number, distance, "
            "par, stroke_index, source_course_id) VALUES\n"
            + values + "\nON CONFLICT (course_name, tee_name, gender, hole_number) DO NOTHING;\n"
        )

    for batch in batched(course_holes_rows, BATCH_SIZE):
        values = ",\n".join(
            f"({sql_str(cn)}, {sql_num(hn)}, {sql_num(par)}, {sql_num(si)}, {sql_num(yd)})"
            for cn, hn, par, si, yd in batch
        )
        lines.append(
            "INSERT INTO course_holes (course_name, hole_number, par, stroke_index, yardage) VALUES\n"
            + values + "\nON CONFLICT (course_name, hole_number) DO NOTHING;\n"
        )

    OUT_PATH.write_text("\n".join(lines))
    print(f"Wrote {OUT_PATH}")
    print(f"course_tees rows: {len(course_tees_rows)}")
    print(f"course_tee_holes rows: {len(course_tee_holes_rows)}")
    print(f"course_holes rows (net-new courses only): {len(course_holes_rows)}")
    print(f"File size: {OUT_PATH.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
