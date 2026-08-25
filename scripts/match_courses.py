#!/usr/bin/env python3
"""
Match the 41 live course_holes.course_name values against the unified course
master workbook, bucketing each into:
  - enrich_in_place: exact normalized-name match -> attach new tee/hole data
    to the EXISTING course_name string (never rename it).
  - ambiguous: a close-but-not-exact match exists -> needs a human decision,
    excluded from the generated migration until resolved.
  - (everything in the unified workbook that matches neither of the above is
    implicitly net-new -> inserted as a brand new course.)

Reads:
  - scripts/live_courses.json (raw `supabase db query` JSON output — see README note below)
  - screenshots/Golf courses/UK & Ireland/TITAN_GLOBAL_GOLF_COURSE_MASTER_UNIFIED.xlsx

Writes:
  - scripts/match_report.csv (every live course + its bucket + candidates)
  - scripts/match_decisions.json (machine-readable: enrich map + net-new list),
    consumed by generate_migration.py
"""
import csv
import difflib
import json
import re
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
UNIFIED_PATH = ROOT / "screenshots" / "Golf courses" / "UK & Ireland" / "TITAN_GLOBAL_GOLF_COURSE_MASTER_UNIFIED.xlsx"
LIVE_COURSES_PATH = ROOT / "scripts" / "live_courses.json"
REPORT_PATH = ROOT / "scripts" / "match_report.csv"
DECISIONS_PATH = ROOT / "scripts" / "match_decisions.json"

EXACT_THRESHOLD = 1.0
FUZZY_THRESHOLD = 0.72  # anything at/above this (but below exact) is "ambiguous", not auto-merged


def normalize_key(name: str) -> str:
    s = name.lower()
    s = s.replace("&", "and")
    s = re.sub(r"[’']", "", s)
    for suf in (" golf club", " golf course", " gc", " golf & country club", " golf and country club"):
        if s.endswith(suf):
            s = s[: -len(suf)]
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_live_names():
    with open(LIVE_COURSES_PATH) as f:
        content = f.read()
    decoder = json.JSONDecoder()
    obj, _ = decoder.raw_decode(content)
    return [r["course_name"] for r in obj["rows"]]


def load_unified_courses():
    wb = openpyxl.load_workbook(UNIFIED_PATH, data_only=True)
    ws = wb["Courses"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}
    out = []
    for r in rows[1:]:
        if r is None or all(v is None for v in r):
            continue
        out.append({
            "country": r[idx["Country / Region"]],
            "course_id": r[idx["Course ID"]],
            "name": r[idx["Official Course Name"]],
        })
    return out


def main():
    live_names = load_live_names()
    unified = load_unified_courses()
    unified_by_key = {}
    for c in unified:
        unified_by_key.setdefault(normalize_key(c["name"] or ""), []).append(c)

    report_rows = []
    enrich_map = {}     # live_course_name -> unified course_id
    ambiguous = []       # live_course_name (excluded from migration until resolved)
    matched_unified_ids = set()

    for live_name in live_names:
        key = normalize_key(live_name)
        exact = unified_by_key.get(key)
        if exact and len(exact) == 1:
            enrich_map[live_name] = exact[0]["course_id"]
            matched_unified_ids.add(exact[0]["course_id"])
            report_rows.append({
                "live_course_name": live_name, "bucket": "enrich_in_place",
                "match_course_id": exact[0]["course_id"], "match_name": exact[0]["name"],
                "match_country": exact[0]["country"], "similarity": "1.00",
            })
            continue
        if exact and len(exact) > 1:
            ambiguous.append(live_name)
            report_rows.append({
                "live_course_name": live_name, "bucket": "ambiguous",
                "match_course_id": ",".join(c["course_id"] for c in exact),
                "match_name": "MULTIPLE EXACT-KEY MATCHES", "match_country": "",
                "similarity": "1.00",
            })
            continue

        # No exact key match — look for a close-but-not-exact candidate.
        all_keys = list(unified_by_key.keys())
        close = difflib.get_close_matches(key, all_keys, n=3, cutoff=FUZZY_THRESHOLD)
        if close:
            candidates = [unified_by_key[k][0] for k in close]
            ratios = [difflib.SequenceMatcher(None, key, k).ratio() for k in close]
            ambiguous.append(live_name)
            report_rows.append({
                "live_course_name": live_name, "bucket": "ambiguous",
                "match_course_id": ",".join(c["course_id"] for c in candidates),
                "match_name": " | ".join(c["name"] for c in candidates),
                "match_country": " | ".join(c["country"] for c in candidates),
                "similarity": ",".join(f"{r:.2f}" for r in ratios),
            })
        else:
            report_rows.append({
                "live_course_name": live_name, "bucket": "no_match_stays_as_is",
                "match_course_id": "", "match_name": "", "match_country": "", "similarity": "",
            })

    net_new = [c for c in unified if c["course_id"] not in matched_unified_ids]

    with open(REPORT_PATH, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "live_course_name", "bucket", "match_course_id", "match_name",
            "match_country", "similarity",
        ])
        w.writeheader()
        w.writerows(report_rows)

    with open(DECISIONS_PATH, "w") as f:
        json.dump({
            "enrich_in_place": enrich_map,   # {live_course_name: course_id}
            "ambiguous": ambiguous,           # [live_course_name, ...] — excluded from migration
            "net_new_course_ids": [c["course_id"] for c in net_new],
        }, f, indent=2)

    print(f"Live courses: {len(live_names)}")
    print(f"  enrich_in_place (exact match): {len(enrich_map)}")
    print(f"  ambiguous (needs human decision, excluded from migration): {len(ambiguous)}")
    print(f"  no_match_stays_as_is: {len(live_names) - len(enrich_map) - len(ambiguous)}")
    print(f"Net-new courses to insert: {len(net_new)}")
    print(f"\nReport -> {REPORT_PATH}")
    print(f"Decisions -> {DECISIONS_PATH}")


if __name__ == "__main__":
    main()
