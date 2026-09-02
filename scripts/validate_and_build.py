import json
from collections import Counter

with open('scripts/parsed_courses.json') as f:
    courses = json.load(f)
with open('scripts/parsed_tees.json') as f:
    tees = json.load(f)
with open('scripts/parsed_tee_holes.json') as f:
    tee_holes = json.load(f)
with open('scripts/parsed_course_holes_raw.json') as f:
    raw = json.load(f)  # course -> tee -> {hole_str: [par, si, dist]}

issues = []
course_holes_final = []  # course_name, hole_number, par, stroke_index, yardage
skipped_courses = []
mismatch_courses = []

# Build gender lookup per (course, tee) from tees list
gender_of = {}
for t in tees:
    gender_of[(t['course_name'], t['tee_name'])] = t['gender']

for cname, tee_map in raw.items():
    # Real courses aren't all 18 holes (genuine 9-hole courses, e.g. Leeds
    # Castle) and aren't all "standard" par either (par-3/executive courses
    # like Sunningdale Heath's Silver course or Herefordshire's Express
    # course are real, verified layouts, not data errors) — canonical hole
    # count is whatever this course's own data actually has, not an
    # assumed 18. Pick the tee with the most holes as canonical (ties
    # broken toward M gender), so a course isn't skipped just because one
    # tee's data is incomplete while another tee has the full set.
    if not tee_map:
        skipped_courses.append((cname, "no hole data at all"))
        continue
    max_holes = max(len(h) for h in tee_map.values())
    candidates = [(t, holes) for t, holes in tee_map.items() if len(holes) == max_holes]

    def sort_key(item):
        t, _ = item
        g = gender_of.get((cname, t), '')
        return (0 if g == 'M' else (1 if g == '' else 2), t)
    candidates.sort(key=sort_key)
    canonical_tee, canonical_holes = candidates[0]
    n_holes = len(canonical_holes)

    if n_holes not in (9, 18):
        issues.append(f"{cname} ({canonical_tee}): unusual hole count {n_holes}, not 9 or 18 — skipped")
        continue

    # validate stroke index is a clean 1..N permutation on canonical tee
    sis = sorted(int(v[1]) for v in canonical_holes.values())
    if sis != list(range(1, n_holes + 1)):
        issues.append(f"{cname} ({canonical_tee}): stroke index not a clean 1-{n_holes} permutation: {sis}")
        continue

    pars = [int(v[0]) for h, v in sorted(canonical_holes.items(), key=lambda kv: int(kv[0]))]
    if any(p < 3 or p > 5 for p in pars):
        issues.append(f"{cname} ({canonical_tee}): a hole par is outside 3-5: {pars}")
        continue

    # cross-tee par/SI agreement check (informational, not blocking) — only
    # compared against other tees with the same hole count as canonical.
    disagreement = False
    for t, holes in candidates[1:]:
        for h_str, (p, si, d) in holes.items():
            cp, csi, cd = canonical_holes.get(h_str, (None, None, None))
            if cp is not None and (int(p) != int(cp) or int(si) != int(csi)):
                disagreement = True
    if disagreement:
        mismatch_courses.append(cname)

    for h_str, (par, si, dist) in canonical_holes.items():
        course_holes_final.append({
            'course_name': cname,
            'hole_number': int(h_str),
            'par': int(par),
            'stroke_index': int(si),
            'yardage': int(dist) if dist is not None else None,
        })

# dedupe check within course_tees / course_tee_holes (should be none given dict-keyed parse, but confirm)
tee_keys = Counter((t['course_name'], t['tee_name'], t['gender']) for t in tees)
tee_dupes = {k: v for k, v in tee_keys.items() if v > 1}

th_keys = Counter((h['course_name'], h['tee_name'], h['gender'], h['hole_number']) for h in tee_holes)
th_dupes = {k: v for k, v in th_keys.items() if v > 1}

print("courses parsed:", len(courses))
print("courses -> canonical course_holes built:", len(course_holes_final) // 18 if course_holes_final else 0)
print("course_holes rows:", len(course_holes_final))
print("courses skipped (no complete 18-hole tee):", len(skipped_courses))
print("courses failing SI/par validation:", len(issues))
print("courses with cross-tee par/SI disagreement (kept, informational):", len(mismatch_courses))
print("duplicate course_tees keys:", len(tee_dupes))
print("duplicate course_tee_holes keys:", len(th_dupes))

with open('scripts/validation_report.txt', 'w') as f:
    f.write("=== SKIPPED COURSES (no 18-hole tee) ===\n")
    for c, r in skipped_courses:
        f.write(f"{c}: {r}\n")
    f.write("\n=== VALIDATION FAILURES (SI/par) ===\n")
    for i in issues:
        f.write(i + "\n")
    f.write("\n=== CROSS-TEE PAR/SI DISAGREEMENT (informational, canonical kept) ===\n")
    for c in mismatch_courses:
        f.write(c + "\n")
    f.write("\n=== DUPLICATE course_tees KEYS ===\n")
    for k, v in tee_dupes.items():
        f.write(f"{k}: {v}\n")
    f.write("\n=== DUPLICATE course_tee_holes KEYS ===\n")
    for k, v in th_dupes.items():
        f.write(f"{k}: {v}\n")

with open('scripts/final_course_holes.json', 'w') as f:
    json.dump(course_holes_final, f)

# Final courses table: only keep courses that made it through validation
valid_course_names = set(h['course_name'] for h in course_holes_final)
final_courses = [{'name': c, 'region': v.get('region')} for c, v in courses.items() if c in valid_course_names]
with open('scripts/final_courses.json', 'w') as f:
    json.dump(final_courses, f)

# Final tees/tee_holes: only for valid courses
final_tees = [t for t in tees if t['course_name'] in valid_course_names]
final_tee_holes = [h for h in tee_holes if h['course_name'] in valid_course_names]
with open('scripts/final_tees.json', 'w') as f:
    json.dump(final_tees, f)
with open('scripts/final_tee_holes.json', 'w') as f:
    json.dump(final_tee_holes, f)

print("\nfinal valid courses:", len(final_courses))
print("final course_tees:", len(final_tees))
print("final course_tee_holes:", len(final_tee_holes))
