#!/usr/bin/env python3
"""
Second France pass, same day: closing genuine gaps in the "France Top 50"
research queue (24 flagged courses; 9 turned out to already be present under
the wider Golfbreaks pass, just with a stale Top 50 status -- see
scripts/patch_france_top50_2026_08_26_notes.md-equivalent commit message).

Of the 15 genuinely missing courses, 8 had a source with a complete,
checksummed 18-hole card + numeric Course Rating/Slope; the other 7 did not
(no guessing, so they're skipped, not estimated):
  - Les Bordes (New & Old): every source disagreed, and two gave a slope of
    166 -- above the legal maximum of 155, so provably wrong. Not added.
  - Morfontaine (Vallière): genuinely a 9-hole course, "Rating N/A / Slope
    N/A" stated explicitly. Doesn't qualify.
  - Golf de Courson (Vert/Noir, Lilas/Orange): golfify.io's own ratings table
    has Slope "-" for every tee. No numeric slope found anywhere. Not added.
  - Joyenval (Marly): golfpass states "Rating N/A" despite giving a slope.
    Not added.
  - Divonne: golfpass states "Rating N/A" despite giving a slope. Not added.

All data below is golfpass.com hole-by-hole grids, cross-checked against
that same page's own tee-ratings summary table (yard/metre conversion
tolerance ~30m, consistent with rounding across this whole project). Bondues'
White tee was excluded specifically: its scorecard-grid total (6479yd/5924m)
doesn't reconcile with its own tee-table entry (6009m) the way every other
tee on that page does -- Yellow/Blue/Red all matched within a few metres,
White was off by 85m, so it was left out rather than guessed at.

Usage:
    python3 scripts/patch_france_top50_2026_08_26.py
"""
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
FRANCE_PATH = ROOT / "screenshots" / "Golf courses" / "euro courses" / "France_GOLFBREAKS_YGT_FRANCE_FINAL_AUDIT_PROGRESS_59.xlsx"

GOLFPASS = "https://www.golfpass.com (course scorecard-and-layout page)"

# Each course: course_id_prefix, official name, club/region/town, holes' Par
# and SI (shared across tees on that course), then a list of tees
# (tee_name, gender, total_distance, course_rating, slope_rating, yardage[18]).
COURSES = [
    {
        "id": "FRA_KEMPFERHOF", "name": "Le Kempferhof", "club": "Golf du Kempferhof",
        "region": "Alsace", "town": "Plobsheim",
        "par":  [4,5,4,5,3,4,3,5,3, 4,5,4,4,3,5,4,3,4],
        "si":   [9,1,15,5,17,3,11,7,13, 2,6,4,10,14,12,16,18,8],
        "tees": [
            ("White", "M", 6549, 72.2, 139, [419,551,376,497,178,384,165,521,177, 314,506,393,420,190,558,330,168,402]),
            ("Yellow", "M", 6045, 69.8, 132, [390,517,361,472,148,351,143,492,164, 285,479,360,392,164,511,297,150,369]),
            ("Blue", "M", 5429, 67.2, 127, [363,480,336,452,131,249,121,439,150, 250,449,318,360,147,471,256,131,326]),
            ("Red", "M", 4898, 64.6, 122, [296,435,309,436,110,268,113,421,108, 230,384,277,312,132,440,229,102,296]),
        ],
    },
    {
        "id": "FRA_VIDAUBAN", "name": "Vidauban Golf Club", "club": "Vidauban Golf Club",
        "region": "South East France", "town": "Vidauban",
        "par":  [4,4,5,3,4,3,4,5,4, 4,3,5,4,5,4,3,4,4],
        "si":   [5,13,3,15,9,17,11,7,1, 12,18,8,2,4,10,16,6,14],
        "tees": [
            ("Black", "M", 6477, 73.8, 141, [402,332,534,169,371,164,332,458,397, 360,169,532,409,531,396,181,386,354]),
        ],
    },
    {
        "id": "FRA_LYON_SANGLIERS", "name": "Lyon Golf Club - Les Sangliers", "club": "Golf Club de Lyon",
        "region": "South East France", "town": "Villette d'Anthon",
        "par":  [4,5,4,3,5,4,4,3,4, 4,4,4,4,3,5,4,3,5],
        "si":   [3,17,9,11,7,1,13,15,5, 16,12,2,4,14,8,10,6,18],
        "tees": [
            ("Black", "M", 6575, 75.5, 140, [415,526,340,162,515,389,358,178,394, 388,382,395,383,179,530,387,183,471]),
            ("White", "M", 6159, 73.0, 134, [357,493,331,155,490,365,316,166,364, 374,374,358,362,166,502,345,178,463]),
            ("Yellow", "M", 5851, 71.3, 129, [339,460,315,145,471,355,312,156,352, 356,356,344,357,137,495,323,160,418]),
            ("Blue", "M", 5306, 68.7, 123, [283,437,275,114,437,325,266,144,315, 316,315,320,324,133,448,297,148,409]),
            ("Red", "M", 4999, 67.1, 120, [272,405,263,109,410,308,261,132,300, 305,307,315,294,114,416,274,136,378]),
        ],
    },
    {
        "id": "FRA_SAINT_CLOUD_VERT", "name": "Saint-Cloud Golf Club - Vert", "club": "Saint Cloud Golf Club",
        "region": "North East France", "town": "Garches",
        "par":  [4,4,5,4,4,3,4,3,4, 4,3,4,3,4,5,4,5,4],
        "si":   [3,7,13,11,9,15,1,17,5, 2,10,6,8,14,16,18,12,4],
        "tees": [
            ("White", "M", 6524, 71.1, 138, [441,453,542,362,383,149,389,148,424, 451,155,420,175,309,494,317,501,411]),
            ("Yellow", "M", 6168, 69.7, 131, [424,395,511,346,361,149,373,148,405, 416,155,372,168,297,469,287,487,405]),
            ("Blue", "M", 5764, 73.3, 137, [386,362,471,320,339,141,361,131,372, 394,147,335,160,278,459,273,468,367]),
            ("Red", "M", 5441, 71.5, 131, [379,351,441,292,328,132,346,118,363, 348,147,322,153,274,381,260,449,357]),
        ],
    },
    {
        "id": "FRA_TAULANE", "name": "Château de Taulane", "club": "Golf du Château de Taulane",
        "region": "South East France", "town": "La Martre",
        "par":  [4,3,5,4,5,4,4,3,4, 4,4,3,5,4,4,4,3,5],
        "si":   [7,17,13,3,5,11,9,15,1, 12,4,8,6,2,14,18,16,10],
        "tees": [
            ("White", "M", 6756, 74.1, 134, [392,171,488,407,512,409,354,168,433, 363,413,201,589,384,434,290,189,559]),
            ("Yellow", "M", 6263, 71.8, 131, [367,153,488,367,492,390,322,144,406, 343,371,178,544,346,408,262,167,515]),
            ("Blue", "M", 5850, 74.1, 127, [344,130,444,349,464,377,308,132,379, 301,351,171,519,336,385,247,159,454]),
            ("Red", "M", 5357, 72.4, 124, [315,124,414,334,427,364,277,110,367, 257,326,149,462,327,332,221,135,416]),
        ],
    },
    {
        "id": "FRA_LA_BOULIE_VALLEE", "name": "La Boulie - La Vallée", "club": "Racing Club de France",
        "region": "North East France", "town": "Versailles",
        "par":  [4,4,3,5,4,4,3,5,4, 3,5,4,3,4,3,4,5,5],
        "si":   [5,1,9,17,3,11,7,13,15, 6,14,12,4,8,10,2,16,18],
        "tees": [
            ("White", "M", 6474, 72.0, 135, [398,445,164,514,463,360,177,503,306, 210,499,335,173,404,187,422,474,440]),
            ("Yellow", "M", 6204, 71.0, 129, [382,427,156,487,418,338,172,497,300, 187,489,327,163,396,171,406,474,414]),
            ("Blue", "M", 5678, 68.7, 124, [365,400,144,402,365,311,155,475,264, 168,444,318,124,351,165,393,453,381]),
            ("Red", "M", 5505, 72.7, 133, [351,392,135,402,365,302,144,439,247, 168,440,303,124,342,155,376,439,381]),
        ],
    },
    {
        "id": "FRA_LA_BOULIE_FORET", "name": "La Boulie - La Forêt", "club": "Racing Club de France",
        "region": "North East France", "town": "Versailles",
        "par":  [4,3,5,4,5,4,4,4,3, 5,3,4,3,5,4,4,4,4],
        "si":   [10,2,18,8,16,14,4,12,6, 9,1,17,7,15,13,3,11,5],
        "tees": [
            ("White", "M", 6658, 73.1, 127, [369,133,484,462,466,365,434,379,182, 581,182,422,156,513,416,404,343,367]),
            ("Yellow", "M", 6433, 72.3, 120, [369,128,475,441,451,357,419,357,174, 557,173,399,147,502,405,392,330,357]),
            ("Blue", "M", 5857, 69.7, 115, [369,122,460,379,435,315,352,318,167, 527,163,363,130,488,392,344,290,243]),
            ("Red", "M", 5617, 73.8, 124, [369,118,452,379,398,315,322,314,161, 499,130,336,122,456,369,344,290,243]),
        ],
    },
    {
        "id": "FRA_BONDUES_TRENT_JONES", "name": "Bondues - Trent Jones", "club": "Bondues Golf Club",
        "region": "North East France", "town": "Bondues",
        "par":  [5,3,4,5,4,3,4,4,5, 5,3,4,4,3,5,3,4,4],
        "si":   [7,11,15,9,1,17,3,5,13, 2,8,10,16,18,14,12,6,4],
        "tees": [
            ("Yellow", "M", 5977, 69.8, 128, [486,160,289,457,379,122,396,385,457, 495,182,357,338,152,439,152,336,395]),
            ("Blue", "M", 5507, 67.7, 123, [448,143,265,422,351,90,377,364,440, 484,163,320,306,138,407,128,283,378]),
            ("Red", "M", 4986, 65.3, 119, [417,120,246,407,312,87,340,312,416, 434,132,279,262,110,392,101,252,367]),
        ],
    },
]

COURSES_HDR = ["Course ID", "Official Course Name", "Club Name", "Region", "Town/Area",
               "Course / Layout", "Holes", "Verification Status", "Primary Source",
               "Last Verified", "Source Quality"]


def assert_checksums():
    for c in COURSES:
        assert len(c["par"]) == 18 and len(c["si"]) == 18, f"{c['name']}: par/si must have 18 entries"
        assert sorted(c["si"]) == list(range(1, 19)), f"{c['name']}: SI must be a permutation of 1-18"
        front_par, back_par = sum(c["par"][:9]), sum(c["par"][9:])
        for tee_name, gender, total_distance, cr, sr, yardage in c["tees"]:
            assert len(yardage) == 18, f"{c['name']} {tee_name}: expected 18 holes, got {len(yardage)}"
            assert sum(yardage) == total_distance, (
                f"{c['name']} {tee_name}: yardage sum {sum(yardage)} != stated total {total_distance}"
            )
            assert front_par + back_par == sum(c["par"]), f"{c['name']}: par mismatch"


def main():
    assert_checksums()

    wb = openpyxl.load_workbook(FRANCE_PATH)
    courses_ws = wb["Courses"]
    tees_ws = wb["Tee Ratings"]
    holes_ws = wb["Hole Data"]

    n_courses = n_tees = n_holes = 0
    for c in COURSES:
        courses_ws.append([
            c["id"], c["name"], c["club"], c["region"], c["town"], c["name"], 18,
            "COMPLETE", GOLFPASS, "2026-08-26",
            "golfpass.com hole-by-hole grid, cross-checked against its own tee-ratings table",
        ])
        n_courses += 1
        for tee_name, gender, total_distance, cr, sr, yardage in c["tees"]:
            tees_ws.append([
                c["id"], c["name"], tee_name, gender, sum(c["par"]), total_distance,
                cr, sr, None, None, GOLFPASS,
            ])
            n_tees += 1
            for i in range(18):
                holes_ws.append([
                    c["id"], c["name"], tee_name, gender, i + 1,
                    yardage[i], c["par"][i], c["si"][i], GOLFPASS,
                ])
                n_holes += 1

    wb.save(FRANCE_PATH)
    print(f"Saved {FRANCE_PATH}")
    print(f"Added {n_courses} courses, {n_tees} tee configs, {n_holes} hole rows")


if __name__ == "__main__":
    main()
