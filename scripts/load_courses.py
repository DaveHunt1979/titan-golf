import json, subprocess, urllib.request, sys

SR = subprocess.check_output("grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2", shell=True).decode().strip()
URL = "https://zzmkdwjkxqeioeukqaie.supabase.co/rest/v1"

def req(method, path, body=None, headers=None):
    h = {"apikey": SR, "Authorization": f"Bearer {SR}", "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{URL}/{path}", data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def delete_all(table, pk_col, pk_neq):
    status, body = req("DELETE", f"{table}?{pk_col}=neq.{pk_neq}", headers={"Prefer": "return=minimal"})
    print(f"DELETE {table}: {status}")
    if status >= 300:
        print(body[:500])
        sys.exit(1)

def insert_batches(table, rows, batch=500):
    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i+batch]
        status, body = req("POST", table, chunk, headers={"Prefer": "return=minimal"})
        if status >= 300:
            print(f"INSERT {table} batch {i}: FAILED {status}")
            print(body[:1000])
            sys.exit(1)
        total += len(chunk)
    print(f"INSERT {table}: {total} rows loaded")

# 1. Delete in FK-safe order
delete_all("course_tee_holes", "id", "00000000-0000-0000-0000-000000000000")
delete_all("course_tees", "id", "00000000-0000-0000-0000-000000000000")
delete_all("course_holes", "id", "00000000-0000-0000-0000-000000000000")
delete_all("courses", "name", "")

# 2. Load new data
with open('scripts/final_courses.json') as f:
    courses = json.load(f)
with open('scripts/final_course_holes.json') as f:
    course_holes = json.load(f)
with open('scripts/final_tees.json') as f:
    tees = json.load(f)
with open('scripts/final_tee_holes.json') as f:
    tee_holes = json.load(f)

insert_batches("courses", courses)
insert_batches("course_holes", course_holes)
insert_batches("course_tees", tees)          # must load before course_tee_holes (FK)
insert_batches("course_tee_holes", tee_holes)

print("done")
