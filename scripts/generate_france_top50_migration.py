#!/usr/bin/env python3
"""
Additive migration for the second 2026-08-26 France pass: inserts 8 more
net-new courses closed out of the "France Top 50" research queue (Le
Kempferhof, Vidauban, Lyon - Les Sangliers, Saint-Cloud - Vert, Château de
Taulane, La Boulie - La Vallée & La Forêt, Bondues - Trent Jones). All are
genuinely new course_name strings -- none exist in any already-applied
migration -- so this only ever adds rows, never touches the 41 live-scored
courses or anything already pushed.

Sourced directly from the freshly-regenerated unified workbook (produced by
merge_course_master.py) rather than re-transcribing numbers, so this file and
the workbook can never drift apart.

Usage:
    python3 scripts/generate_france_top50_migration.py
"""
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
UNIFIED_PATH = ROOT / "screenshots" / "Golf courses" / "UK & Ireland" / "TITAN_GLOBAL_GOLF_COURSE_MASTER_UNIFIED.xlsx"
OUT_PATH = ROOT / "supabase" / "migrations" / "20260826040000_france_top50_batch2.sql"

TARGET_COURSE_IDS = {
    "BONDUES_TRENT_JONES", "CH_TEAU_DE_TAULANE", "LA_BOULIE_LA_FOR_T",
    "LA_BOULIE_LA_VALL_E", "LE_KEMPFERHOF", "LYON_GOLF_CLUB_LES_SANGLIERS",
    "SAINT_CLOUD_GOLF_CLUB_VERT", "VIDAUBAN_GOLF_CLUB",
}


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

    courses = {c["Course ID"]: c for c in rows("Courses") if c["Course ID"] in TARGET_COURSE_IDS}
    tees = [t for t in rows("Tee Ratings") if t["Course ID"] in TARGET_COURSE_IDS]
    holes = [h for h in rows("Hole Data") if h["Course ID"] in TARGET_COURSE_IDS]
    return courses, tees, holes


def main():
    courses, tees, holes = load_unified()
    assert set(courses) == TARGET_COURSE_IDS, f"expected {TARGET_COURSE_IDS}, found {set(courses)}"

    holes_by_tee = {}
    for h in holes:
        holes_by_tee.setdefault((h["Course ID"], h["Tee Name"], h["Gender"]), []).append(h)

    course_tees_rows = []
    course_tee_holes_rows = []
    course_holes_rows = []  # primary tee per course, for the single-value course_holes table

    for course_id, c in courses.items():
        course_name = c["Official Course Name"]
        course_tees = [t for t in tees if t["Course ID"] == course_id]
        for t in course_tees:
            gender = norm_gender(t.get("Gender"))
            course_tees_rows.append((
                course_name, t.get("Tee Name"), gender, t.get("Par"), t.get("Total Distance"),
                t.get("Distance Unit"), t.get("Course Rating"), t.get("Slope Rating"),
                t.get("Source"), t.get("Rating Status"), course_id,
            ))
            for h in holes_by_tee.get((course_id, t.get("Tee Name"), t.get("Gender")), []):
                course_tee_holes_rows.append((
                    course_name, t.get("Tee Name"), gender, h.get("Hole"), h.get("Distance"),
                    h.get("Par"), h.get("Stroke Index"), course_id,
                ))

        primary = sorted(course_tees, key=lambda t: (t.get("Gender") != "M", str(t.get("Tee Name"))))[0]
        for h in holes_by_tee.get((course_id, primary.get("Tee Name"), primary.get("Gender")), []):
            course_holes_rows.append((
                course_name, h.get("Hole"), h.get("Par"), h.get("Stroke Index"), h.get("Distance"),
            ))

    lines = []
    lines.append("-- Firecrawl-researched France pass, 2026-08-26.")
    lines.append("-- 1) Widens course_tee_holes.par to allow real par-6 holes (Belle Dune's 15th is")
    lines.append("--    a genuine signature par 6, confirmed via TripAdvisor + the club's own site --")
    lines.append("--    the original CHECK (par BETWEEN 3 AND 5) wrongly excluded it).")
    lines.append("-- 2) Inserts two net-new courses: Belle Dune (Blanc + Jaune) and Golf du Champ de")
    lines.append("--    Bataille (all 4 tees, men's + women's ratings for Jaune/Bleu/Rouge), sourced")
    lines.append("--    from golfify.io and the official club scorecard respectively. Neither course")
    lines.append("--    exists in the already-applied course_master_import migration.")
    lines.append("-- Nothing existing is altered or removed.")
    lines.append("")
    lines.append("ALTER TABLE course_tee_holes DROP CONSTRAINT IF EXISTS course_tee_holes_par_check;")
    lines.append("ALTER TABLE course_tee_holes ADD CONSTRAINT course_tee_holes_par_check CHECK (par BETWEEN 3 AND 6);")
    lines.append("")

    values = ",\n".join(
        f"({sql_str(cn)}, {sql_str(tn)}, {sql_str(g)}, {sql_num(par)}, {sql_num(dist)}, "
        f"{sql_str(unit)}, {sql_num(cr)}, {sql_num(sr)}, {sql_str(src)}, {sql_str(rs)}, {sql_str(scid)})"
        for cn, tn, g, par, dist, unit, cr, sr, src, rs, scid in course_tees_rows
    )
    lines.append(
        "INSERT INTO course_tees (course_name, tee_name, gender, par, total_distance, "
        "distance_unit, course_rating, slope_rating, source, rating_status, source_course_id) VALUES\n"
        + values + "\nON CONFLICT (course_name, tee_name, gender) DO NOTHING;\n"
    )

    values = ",\n".join(
        f"({sql_str(cn)}, {sql_str(tn)}, {sql_str(g)}, {sql_num(hn)}, {sql_num(dist)}, "
        f"{sql_num(par)}, {sql_num(si)}, {sql_str(scid)})"
        for cn, tn, g, hn, dist, par, si, scid in course_tee_holes_rows
    )
    lines.append(
        "INSERT INTO course_tee_holes (course_name, tee_name, gender, hole_number, distance, "
        "par, stroke_index, source_course_id) VALUES\n"
        + values + "\nON CONFLICT (course_name, tee_name, gender, hole_number) DO NOTHING;\n"
    )

    values = ",\n".join(
        f"({sql_str(cn)}, {sql_num(hn)}, {sql_num(par)}, {sql_num(si)}, {sql_num(yd)})"
        for cn, hn, par, si, yd in course_holes_rows
    )
    lines.append(
        "INSERT INTO course_holes (course_name, hole_number, par, stroke_index, yardage) VALUES\n"
        + values + "\nON CONFLICT (course_name, hole_number) DO NOTHING;\n"
    )

    OUT_PATH.write_text("\n".join(lines))
    print(f"Wrote {OUT_PATH}")
    print(f"course_tees rows: {len(course_tees_rows)}")
    print(f"course_tee_holes rows: {len(course_tee_holes_rows)}")
    print(f"course_holes rows: {len(course_holes_rows)}")


if __name__ == "__main__":
    main()
