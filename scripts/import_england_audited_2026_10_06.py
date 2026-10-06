#!/usr/bin/env python3
"""Rebuild England tee/hole data from TITAN_ENGLAND_MASTER_AUDITED_2026-10-06.xlsx.
Usage: python3 scripts/import_england_audited_2026_10_06.py [--apply]
Rules: keep live course_name strings (never rename); upsert verified tees/holes;
never delete a tee referenced by a saved round/day/swindle; held (unverified)
tees are left untouched; GPS untouched. Backs up live tables first."""
import sys,os,json,collections,urllib.request,openpyxl
APPLY='--apply' in sys.argv
XLSX='screenshots/TITAN_ENGLAND_MASTER_AUDITED_2026-10-06.xlsx'
env=dict(l.strip().split('=',1) for l in open('.env.local') if '=' in l and not l.startswith('#'))
U=env['EXPO_PUBLIC_SUPABASE_URL'];K=env['SUPABASE_SERVICE_ROLE_KEY']
H={'apikey':K,'Authorization':'Bearer '+K,'Content-Type':'application/json'}
def req(method,path,body=None,prefer=None):
    h=dict(H)
    if prefer:h['Prefer']=prefer
    r=urllib.request.Request(f"{U}/rest/v1/{path}",data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
    try: return urllib.request.urlopen(r).read()
    except urllib.error.HTTPError as e: raise SystemExit(f"{method} {path} -> {e.code} {e.read()[:400]}")
def get(q):
    out=[];o=0
    while True:
        d=json.loads(req('GET',f"{q}&limit=1000&offset={o}"));out+=d
        if len(d)<1000:break
        o+=1000
    return out
def chunks(l,n=500):
    for i in range(0,len(l),n): yield l[i:i+n]
g=lambda x:'F' if x=='W' else x

wb=openpyxl.load_workbook(XLSX,read_only=True)
rows=lambda n:[r for r in wb[n].iter_rows(values_only=True)][1:]
xc,xt,xh=rows('Courses'),rows('Tee Ratings'),rows('Hole Data')

live_courses=get('courses?select=*&order=name.asc')
live_tees=get('course_tees?select=*&order=id.asc')
live_ch=get('course_holes?select=id,course_name,hole_number,par,stroke_index,yardage&order=id.asc')
# map xlsx Course ID -> live course_name via source_course_id on existing tees
sid=collections.defaultdict(set)
for t in live_tees:
    if t.get('source_course_id'): sid[t['source_course_id']].add(t['course_name'])
names={c['name'] for c in live_courses}
cname={};new_courses=[]
for r in xc:
    cid,nm=r[0],r[1]
    if cid=='BREADSALL_PRIORY_PRIORY' or cid in sid and len(sid[cid])==1: cname[cid]=next(iter(sid[cid])) if cid in sid else nm
    elif nm in names: cname[cid]=nm
    else: cname[cid]=nm;new_courses.append(r)
# Lullingstone: two layouts collapsed onto one live name — split into per-layout courses
# (matches the 'Club - Layout' convention); the original single row is left untouched.
for r in xc:
    if r[0].startswith('LULLINGSTONE_PARK_GOLF_COURSE_'):
        nm=f"{r[1]} - {r[5]}"
        cname[r[0]]=nm
        if nm not in names: new_courses.append((r[0],nm)+tuple(r[2:]))
tee_rows=collections.defaultdict(list)
for r in xt: tee_rows[r[0]]=tee_rows[r[0]]  # placeholder
tbyid={r[0]:r for r in xt}
holes=collections.defaultdict(list)
for r in xh: holes[r[0]].append(r)
for v in holes.values(): v.sort(key=lambda r:r[1])

if APPLY:
    bd='scripts/course_backup_20261006';os.makedirs(bd,exist_ok=True)
    json.dump(live_tees,open(f'{bd}/course_tees.json','w'))
    json.dump(live_ch,open(f'{bd}/course_holes.json','w'))
    json.dump(get('course_tee_holes?select=*&order=id.asc'),open(f'{bd}/course_tee_holes.json','w'))
    json.dump(live_courses,open(f'{bd}/courses.json','w'))
    print('backup written to',bd)

# --- 1. new courses
print('new courses:',[r[1] for r in new_courses])
if APPLY and new_courses:
    req('POST','courses',[{'name':r[1],'lat':r[11],'lng':r[12],'region':r[3],'country':'England'} for r in new_courses],'return=minimal')

# --- 2. tees
tee_payload=[];key_of_cfg={}
for r in xt:
    cid=r[1];n=cname[cid];k=(n,r[2],g(r[3]));key_of_cfg[r[0]]=k
    tee_payload.append({'course_name':n,'tee_name':r[2],'gender':g(r[3]),'par':r[4],'total_distance':r[5],'distance_unit':'yd','course_rating':r[6],'slope_rating':r[7],'source':r[8],'rating_status':'VERIFIED','source_course_id':cid})
print('tees to upsert',len(tee_payload))
if APPLY:
    for c in chunks(tee_payload): req('POST','course_tees?on_conflict=course_name,tee_name,gender',c,'resolution=merge-duplicates,return=minimal')

# --- 3. tee holes
th=[]
for r in xt:
    k=key_of_cfg[r[0]]
    for h in holes[r[0]]:
        th.append({'course_name':k[0],'tee_name':k[1],'gender':k[2],'hole_number':h[1],'distance':h[2],'par':h[3],'stroke_index':h[4],'source_course_id':r[1]})
print('tee holes to upsert',len(th))
if APPLY:
    for c in chunks(th): req('POST','course_tee_holes?on_conflict=course_name,tee_name,gender,hole_number',c,'resolution=merge-duplicates,return=minimal')

# --- 4. course_holes (scoring par/SI): one reference tee per course
live_by=collections.defaultdict(dict)
for h in live_ch: live_by[h['course_name']][h['hole_number']]=h
upd=[];ins=[];skipped=[];changed_si=0
for r in xc:
    cid=r[0];n=cname[cid];ts=[t for t in xt if t[1]==cid] if False else None
by_cid=collections.defaultdict(list)
for t in xt: by_cid[t[1]].append(t)
for r in xc:
    cid=r[0];n=cname[cid];ts=by_cid.get(cid)
    if not ts: continue
    lh=live_by.get(n,{})
    def arr(t): return [(h[3],h[4]) for h in holes[t[0]]]
    live_arr=[(lh[i]['par'],lh[i]['stroke_index']) for i in sorted(lh)]
    ref=next((t for t in ts if arr(t)==live_arr),None)   # keep live scoring if it already matches a verified tee
    if not ref:
        men=[t for t in ts if t[3]=='M'] or ts
        ref=next((t for t in men if 'white' in t[2].lower()),None) or max(men,key=lambda t:t[5] or 0)
    hs=holes[ref[0]]
    if lh and len(lh)!=len(hs): skipped.append((n,len(lh),len(hs)));continue
    if lh and not (ref and arr(ref)==live_arr): changed_si+=1
    for h in hs:
        row={'course_name':n,'hole_number':h[1],'par':h[3],'stroke_index':h[4],'yardage':h[2]}
        if h[1] in lh: row['id']=lh[h[1]]['id'];upd.append(row)
        else: ins.append(row)
print('course_holes update',len(upd),'insert',len(ins),'courses with changed par/SI',changed_si,'skipped(len mismatch)',skipped)
if APPLY:
    for c in chunks(upd): req('POST','course_holes',c,'resolution=merge-duplicates,return=minimal')
    for c in chunks(ins): req('POST','course_holes',c,'return=minimal')

# --- 5. superseded tees: unreferenced old keys on rebuilt courses that the audit replaced
refs=set()
def addrefs(q,tk,gk):
    for d in get(q):
        if d.get(tk): refs.add((d['course_name'],d[tk],d.get(gk) or ''))
addrefs('competition_days?select=course_name,tee_name,tee_gender','tee_name','tee_gender')
addrefs('swindle_games?select=course_name,tee_name,tee_gender','tee_name','tee_gender')
days={d['id']:d for d in get('competition_days?select=id,course_name')};games={d['id']:d for d in get('swindle_games?select=id,course_name')}
for p in get('round_player_tees?select=day_id,swindle_game_id,tee_name,gender'):
    s=days.get(p['day_id']) or games.get(p['swindle_game_id'])
    if s and p['tee_name']: refs.add((s['course_name'],p['tee_name'],p['gender'] or ''))
held=set()
for r in rows('Held Tees'):
    c=cname.get(r[1])
    if c: held.add((c,r[2],g(r[3])))
newkeys=set(key_of_cfg.values());rebuilt={k[0] for k in newkeys}
stale=[t for t in live_tees if t['course_name'] in rebuilt and (t['course_name'],t['tee_name'],t['gender']) not in newkeys]
dele=[t for t in stale if (t['course_name'],t['tee_name'],t['gender']) not in held and (t['course_name'],t['tee_name'],t['gender']) not in refs]
print('stale live tees',len(stale),'-> held kept',sum(1 for t in stale if (t['course_name'],t['tee_name'],t['gender']) in held),'referenced kept',sum(1 for t in stale if (t['course_name'],t['tee_name'],t['gender']) in refs),'superseded to delete',len(dele))
json.dump([[t['course_name'],t['tee_name'],t['gender']] for t in dele],open('scripts/course_backup_20261006_superseded.json','w')) if APPLY else None
if APPLY:
    for t in ([] if '--skip-delete' in sys.argv else dele):
        req('DELETE',f"course_tees?id=eq.{t['id']}",prefer='return=minimal')
print('DONE' if APPLY else 'DRY RUN — re-run with --apply')
