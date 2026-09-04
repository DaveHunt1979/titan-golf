'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Check, Coins, Search } from 'lucide-react';
import {
  CURRENCIES, HCP_ALLOWANCES, PRIZE_METHODS, PRIZE_SPLITS, WEEKDAYS,
  buildSwindleTeeSnapshot, genJoinCode, ordinal,
  type PrizeMethod,
} from '@/lib/swindle';

// Web twin of app/(app)/swindle/create.tsx — same single-screen form (not a
// wizard), same fields, same exact DB writes, so a swindle created here is
// indistinguishable from one created on a phone. Every option list lives in
// @/lib/swindle so the two never drift apart on splits or allowances.

type CourseRow = { name: string; region: string | null; country: string | null };
type CourseHole = { hole_number: number; par: number };
type Tee = {
  tee_name: string;
  gender: string;
  par: number | null;
  course_rating: number | null;
  slope_rating: number | null;
};

// Same grouping as the mobile course pickers — keep in sync if that changes.
const COUNTRY_TO_GROUP: Record<string, string> = {
  England: 'UK', Scotland: 'UK', Wales: 'UK', Ireland: 'UK', 'Northern Ireland': 'UK', 'Isle of Man': 'UK',
  France: 'Europe', Spain: 'Europe', Portugal: 'Europe', Italy: 'Europe', Germany: 'Europe', Austria: 'Europe',
  Belgium: 'Europe', Netherlands: 'Europe', Denmark: 'Europe', 'Czech Republic': 'Europe', Greece: 'Europe', Turkey: 'Europe',
  USA: 'USA',
  Morocco: 'Africa', 'South Africa': 'Africa',
  UAE: 'Middle East',
};
const COURSE_GROUP_ORDER = ['UK', 'Europe', 'USA', 'Africa', 'Middle East'];

const INPUT_CLS =
  'w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none transition-colors focus:border-[var(--gold)]/50 focus:ring-1 focus:ring-[var(--gold)]/20';

// The courses tables passed the PostgREST 1000-row default cap during the
// course-database rebuild; unpaginated, every course past row 1000 silently
// vanished from the picker (same bug already fixed on mobile).
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; from < 20000; from += size) {
    const { data } = await page(from, from + size - 1);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

export default function CreateSwindlePage({ params }: { params: Promise<{ societyId: string }> }) {
  const { societyId } = use(params);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [gate,        setGate]        = useState<'checking' | 'ok'>('checking');
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [me,          setMe]          = useState<{ id: string; handicap_index: number | null } | null>(null);

  const [courses,     setCourses]     = useState<CourseRow[]>([]);
  const [courseHoles, setCourseHoles] = useState<CourseHole[]>([]);
  const [tees,        setTees]        = useState<Tee[]>([]);

  const [name,         setName]         = useState('');
  const [format,       setFormat]       = useState<'stableford' | 'stroke'>('stableford');
  const [hcpAllowance, setHcpAllowance] = useState<number>(100);
  const [whsEnabled,   setWhsEnabled]   = useState(false);
  const [course,       setCourse]       = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [courseGroup,  setCourseGroup]  = useState<string | null>(null);
  const [teeName,      setTeeName]      = useState('');
  const [fee,          setFee]          = useState('5');
  const [currency,     setCurrency]     = useState<string>('£');
  const [splitIdx,     setSplitIdx]     = useState(0);
  const [prizeMethod,  setPrizeMethod]  = useState<PrizeMethod>('collector');
  const [isRecurring,  setIsRecurring]  = useState(false);
  const [recurringDay, setRecurringDay] = useState<string>('saturday');
  const [twosEnabled,  setTwosEnabled]  = useState(false);
  const [twosFee,      setTwosFee]      = useState('');
  const [ntpEnabled,   setNtpEnabled]   = useState(false);
  const [ntpHole,      setNtpHole]      = useState<number | null>(null);
  const [ntpFee,       setNtpFee]       = useState('');
  const [ldEnabled,    setLdEnabled]    = useState(false);
  const [ldHole,       setLdHole]       = useState<number | null>(null);
  const [ldFee,        setLdFee]        = useState('');

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // ── Gate: admin/owner of THIS society, same check as /admin ──────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/auth/login'); return; }

      const { data: player } = await supabase
        .from('players').select('id, handicap_index').eq('auth_uid', user.id).maybeSingle();
      if (!player) { router.replace('/dashboard'); return; }

      const { data: member } = await supabase
        .from('society_members').select('role')
        .eq('player_id', player.id).eq('society_id', societyId).maybeSingle();
      if (!member || !['admin', 'owner'].includes(member.role ?? '')) { router.replace('/dashboard'); return; }

      const { data: society } = await supabase.from('societies').select('name').eq('id', societyId).maybeSingle();
      setSocietyName((society as { name: string } | null)?.name ?? null);
      setMe({ id: player.id, handicap_index: player.handicap_index ?? null });
      setGate('ok');
    })();
  }, [supabase, router, societyId]);

  // ── Course list ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (gate !== 'ok') return;
    (async () => {
      const [holeRows, courseRows] = await Promise.all([
        fetchAllRows<{ course_name: string }>((from, to) =>
          supabase.from('course_holes').select('course_name').range(from, to)),
        fetchAllRows<CourseRow>((from, to) =>
          supabase.from('courses').select('name, region, country').range(from, to)),
      ]);
      const regionMap: Record<string, string | null> = {};
      const countryMap: Record<string, string | null> = {};
      for (const r of courseRows) { regionMap[r.name] = r.region; countryMap[r.name] = r.country; }
      const names = [...new Set(holeRows.map(r => r.course_name).filter(Boolean))].sort();
      setCourses(names.map(n => ({ name: n, region: regionMap[n] ?? null, country: countryMap[n] ?? null })));
    })();
  }, [gate, supabase]);

  // ── Holes + tees for the picked course ──────────────────────────────────
  const loadCourse = useCallback(async (courseName: string) => {
    if (!courseName) { setCourseHoles([]); setTees([]); setTeeName(''); setNtpHole(null); setLdHole(null); return; }
    const [{ data: holes }, { data: teeRows }] = await Promise.all([
      supabase.from('course_holes').select('hole_number, par').eq('course_name', courseName).order('hole_number'),
      // One shared shape with the mobile TeePickerSheet's fetchCourseTees —
      // course_tees is reference data from the course-master import, never guessed.
      supabase.from('course_tees').select('tee_name, gender, par, course_rating, slope_rating')
        .eq('course_name', courseName).order('tee_name'),
    ]);
    setCourseHoles((holes ?? []) as CourseHole[]);
    const list = (teeRows ?? []) as Tee[];
    setTees(list);
    setNtpHole(null); setLdHole(null);
    // Same default-tee convention as the mobile builder — prefer a "White"
    // men's tee, else the first tee with complete rating data.
    const complete = list.filter(t => t.course_rating != null && t.slope_rating != null);
    const pick = complete.find(t => t.tee_name.toLowerCase() === 'white') ?? complete[0] ?? null;
    setTeeName(pick ? teeKey(pick) : '');
  }, [supabase]);

  useEffect(() => { loadCourse(course); }, [course, loadCourse]);

  const tee = tees.find(t => teeKey(t) === teeName) ?? null;
  const par3s = courseHoles.filter(h => h.par === 3);
  const par5s = courseHoles.filter(h => h.par === 5);

  const groupsAvailable = useMemo(() => [
    { key: null as string | null, label: 'All' },
    ...COURSE_GROUP_ORDER
      .filter(g => courses.some(c => (c.country ? COUNTRY_TO_GROUP[c.country] : null) === g))
      .map(g => ({ key: g as string | null, label: g })),
    ...(courses.some(c => !c.country || !COUNTRY_TO_GROUP[c.country]) ? [{ key: 'Other' as string | null, label: 'Other' }] : []),
  ], [courses]);

  const visibleCourses = useMemo(() => courses
    .filter(c => c.name.toLowerCase().includes(courseSearch.toLowerCase()))
    .filter(c => {
      if (courseGroup === null) return true;
      const g = c.country ? COUNTRY_TO_GROUP[c.country] ?? null : null;
      return courseGroup === 'Other' ? g === null : g === courseGroup;
    })
    .slice(0, 300),
  [courses, courseSearch, courseGroup]);

  const entryFee = parseFloat(fee);
  const canCreate = name.trim().length >= 2 && !Number.isNaN(entryFee) && entryFee >= 0 && !saving;

  // ── Create ──────────────────────────────────────────────────────────────
  async function create() {
    if (!me || !canCreate) return;
    setSaving(true); setError('');

    const base = {
      name: name.trim(),
      course_name: course.trim() || null,
      entry_fee: entryFee,
      currency,
      prize_split: PRIZE_SPLITS[splitIdx].value,
      prize_money_method: prizeMethod,
      collector_player_id: prizeMethod === 'collector' ? me.id : null,
      status: 'open',
      created_by: me.id,
      society_id: societyId,
      game_date: new Date().toISOString().split('T')[0],
      is_recurring: isRecurring,
      recurring_day: isRecurring ? recurringDay : null,
      format,
      hcp_allowance: hcpAllowance,
      tee_name:      tee?.tee_name ?? null,
      tee_gender:    tee?.gender ?? null,
      tee_par:       tee?.par ?? null,
      slope_rating:  tee?.slope_rating ?? 113,
      course_rating: tee?.course_rating ?? null,
      whs_enabled: whsEnabled,
      twos_enabled: twosEnabled,
      twos_fee: twosEnabled && twosFee ? parseFloat(twosFee) || 0 : 0,
      ntp_hole: ntpEnabled ? ntpHole : null,
      ntp_fee: ntpEnabled && ntpFee ? parseFloat(ntpFee) || 0 : 0,
      ld_hole: ldEnabled ? ldHole : null,
      ld_fee: ldEnabled && ldFee ? parseFloat(ldFee) || 0 : 0,
    };

    // join_code is unique — retry on a 23505 collision rather than failing,
    // exactly like the mobile creator.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error: insErr } = await supabase
        .from('swindle_games').insert({ ...base, join_code: genJoinCode() }).select('id, join_code').single();

      if (!insErr && data) {
        // The creator auto-joins their own game, then gets the shared-tee
        // snapshot written so scoring resolves their WHS handicap identically
        // to a mobile-created swindle.
        await supabase.from('swindle_entries').insert({ game_id: data.id, player_id: me.id });
        const snapshot = buildSwindleTeeSnapshot(
          {
            tee_name: tee?.tee_name ?? null, tee_gender: tee?.gender ?? null, tee_par: tee?.par ?? null,
            course_rating: tee?.course_rating ?? null, slope_rating: tee?.slope_rating ?? null,
            whs_enabled: whsEnabled, hcp_allowance: hcpAllowance,
          },
          me.handicap_index,
        );
        if (snapshot) {
          await supabase.from('round_player_tees').upsert(
            { swindle_game_id: data.id, player_id: me.id, ...snapshot },
            { onConflict: 'swindle_game_id,player_id' },
          );
        }
        router.push(`/swindle/${societyId}/manage/${data.id}`);
        return;
      }
      if (insErr?.code === '23505') continue;
      setError(insErr?.message ?? 'Could not create the swindle.');
      break;
    }
    setSaving(false);
  }

  if (gate !== 'ok') {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-sm text-neutral-500">Checking access…</div>
    );
  }

  const split = PRIZE_SPLITS[splitIdx].value;

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-2xl px-6 py-12">
        <Link
          href={`/swindle/${societyId}/manage`}
          className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:text-[var(--gold-bright)]"
        >
          ← Back to Swindle Manager
        </Link>

        <div className="mt-5 mb-8 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
            {societyName ?? 'Society'} · New Swindle
          </div>
          <h1 className="mt-1.5 text-[40px] font-black leading-[0.95] tracking-tight text-white">Create Swindle</h1>
          <p className="mt-3 max-w-md text-sm text-neutral-400">
            Everything on one screen, exactly like the app. Players join with the 6-character code generated on save.
          </p>
        </div>

        <div className="space-y-6">

          {/* ── Format ─────────────────────────────────────────── */}
          <Field label="Format">
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'stableford' as const, label: 'Stableford', sub: 'Higher pts wins' },
                { id: 'stroke'     as const, label: 'Stroke Play', sub: 'Lowest net wins' },
              ]).map(f => (
                <Choice key={f.id} active={format === f.id} onClick={() => setFormat(f.id)} label={f.label} sub={f.sub} />
              ))}
            </div>
          </Field>

          {/* ── Handicap allowance ─────────────────────────────── */}
          <Field label="Handicap Allowance">
            <div className="grid grid-cols-4 gap-2">
              {HCP_ALLOWANCES.map(h => (
                <Choice key={h.value} active={hcpAllowance === h.value} onClick={() => setHcpAllowance(h.value)} label={h.label} sub={h.desc} />
              ))}
            </div>
          </Field>

          {/* ── WHS ────────────────────────────────────────────── */}
          <Field label="WHS Handicap" hint="Calculates each player's handicap from the game's tee ratings">
            <div className="grid grid-cols-2 gap-2">
              {[false, true].map(v => (
                <Choice key={String(v)} active={whsEnabled === v} onClick={() => setWhsEnabled(v)} label={v ? 'On' : 'Off'} />
              ))}
            </div>
            {whsEnabled && tee && (tee.course_rating == null || tee.slope_rating == null || tee.par == null) && (
              <p className="mt-2 text-[11px] font-semibold text-[var(--red)]">
                This tee has incomplete rating data — WHS will fall back to the standard handicap until it&apos;s filled in.
              </p>
            )}
          </Field>

          {/* ── Name ───────────────────────────────────────────── */}
          <Field label="Game Name" hint="e.g. Tuesday Swindle">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Tuesday Swindle" className={INPUT_CLS} />
          </Field>

          {/* ── Course ─────────────────────────────────────────── */}
          <Field label="Course" hint="optional">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {groupsAvailable.map(opt => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setCourseGroup(opt.key)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                    courseGroup === opt.key
                      ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold-bright)]'
                      : 'border-[#1c1c1c] bg-[#0a0a0a] text-neutral-500 hover:border-neutral-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600" />
              <input
                value={courseSearch}
                onChange={e => setCourseSearch(e.target.value)}
                placeholder={courses.length ? `Search ${courses.length} courses…` : 'Loading courses…'}
                className={`${INPUT_CLS} pl-9`}
              />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[#1c1c1c]">
              <button
                type="button"
                onClick={() => setCourse('')}
                className={`flex w-full items-center justify-between border-b border-[#1c1c1c] px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/3 ${
                  course === '' ? 'bg-[var(--gold)]/6 text-[var(--gold-bright)]' : 'bg-[#000000] text-neutral-400'
                }`}
              >
                No course
                {course === '' && <Check size={14} />}
              </button>
              {visibleCourses.map(c => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setCourse(c.name)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-[#1c1c1c] px-4 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-white/3 ${
                    course === c.name ? 'bg-[var(--gold)]/6 text-[var(--gold-bright)]' : 'bg-[#000000] text-white'
                  }`}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  {course === c.name
                    ? <Check size={14} className="shrink-0" />
                    : <span className="shrink-0 text-[10px] uppercase tracking-widest text-neutral-600">{c.country ?? ''}</span>}
                </button>
              ))}
              {visibleCourses.length === 0 && (
                <div className="bg-[#000000] px-4 py-6 text-center text-xs text-neutral-600">No courses match that search.</div>
              )}
            </div>
          </Field>

          {/* ── Tee box ────────────────────────────────────────── */}
          <Field label="Tee Box" hint={course ? 'everyone in this swindle plays this tee' : 'pick a course first'}>
            {!course ? (
              <div className="rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-neutral-600">
                Select a course to choose a tee.
              </div>
            ) : tees.length === 0 ? (
              <div className="rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-neutral-600">
                No tee data on file for this course.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {tees.map(t => {
                  const key = teeKey(t);
                  const incomplete = t.par == null || t.course_rating == null || t.slope_rating == null;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTeeName(key)}
                      className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                        teeName === key
                          ? 'border-[var(--gold)]/50 bg-[var(--gold)]/8'
                          : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700'
                      }`}
                    >
                      <div className={`text-sm font-bold ${teeName === key ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                        {t.tee_name}{t.gender ? ` (${t.gender})` : ''}
                      </div>
                      <div className={`mt-0.5 font-mono text-[11px] tabular-nums ${incomplete ? 'text-[var(--red)]' : 'text-neutral-500'}`}>
                        {incomplete ? 'Rating data incomplete' : `Par ${t.par} · CR ${t.course_rating} · Slope ${t.slope_rating}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          {/* ── Entry fee ──────────────────────────────────────── */}
          <Field label="Entry Fee">
            <div className="flex gap-2">
              {CURRENCIES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`h-[46px] w-12 rounded-lg border text-sm font-bold transition-colors ${
                    currency === c
                      ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold-bright)]'
                      : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  {c}
                </button>
              ))}
              <input
                value={fee}
                onChange={e => setFee(e.target.value)}
                inputMode="decimal"
                placeholder="5"
                className={`${INPUT_CLS} flex-1 font-mono tabular-nums`}
              />
            </div>
          </Field>

          {/* ── Prize split ────────────────────────────────────── */}
          <Field label="Prize Split">
            <div className="space-y-2">
              {PRIZE_SPLITS.map((sp, i) => (
                <button
                  key={sp.label}
                  type="button"
                  onClick={() => setSplitIdx(i)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    splitIdx === i ? 'border-[var(--gold)]/50 bg-[var(--gold)]/8' : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700'
                  }`}
                >
                  <div className={`text-sm font-bold ${splitIdx === i ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{sp.label}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sp.value.map((v, j) => (
                      <span
                        key={j}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          splitIdx === i ? 'bg-[var(--gold)]/15 text-[var(--gold-bright)]' : 'bg-[#111111] text-neutral-500'
                        }`}
                      >
                        {ordinal(j)} {v}%
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            {!Number.isNaN(entryFee) && entryFee > 0 && (
              <p className="mt-2 text-[11px] font-semibold text-neutral-500">
                With 10 entrants that&apos;s a {currency}{(entryFee * 10).toFixed(2)} pot ·{' '}
                <span className="text-[var(--purple)]">
                  {split.map((pct, i) => `${ordinal(i)} ${currency}${(entryFee * 10 * pct / 100).toFixed(2)}`).join(' · ')}
                </span>
              </p>
            )}
          </Field>

          {/* ── Prize money method ─────────────────────────────── */}
          <Field label="Prize Money Method">
            <div className="space-y-2">
              {PRIZE_METHODS.map(pm => (
                <button
                  key={pm.value}
                  type="button"
                  onClick={() => setPrizeMethod(pm.value)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                    prizeMethod === pm.value ? 'border-[var(--gold)]/50 bg-[var(--gold)]/8' : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700'
                  }`}
                >
                  <div className={`text-sm font-bold ${prizeMethod === pm.value ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{pm.label}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">{pm.desc}</div>
                </button>
              ))}
            </div>
            {prizeMethod === 'collector' && (
              <p className="mt-2 text-[11px] font-semibold text-neutral-500">
                You&apos;re set as the collector — change it later from the game&apos;s manage page.
              </p>
            )}
          </Field>

          {/* ── Recurring ──────────────────────────────────────── */}
          <Toggle
            label="Recurring Game"
            title="Weekly Roll-Up"
            desc="Players tap &quot;I'm in&quot; each week to enter — perfect for a Saturday or Sunday morning swindle"
            on={isRecurring}
            setOn={setIsRecurring}
          >
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setRecurringDay(day)}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold capitalize transition-colors ${
                    recurringDay === day
                      ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold-bright)]'
                      : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700'
                  }`}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </Toggle>

          {/* ── Two's ──────────────────────────────────────────── */}
          <Toggle
            label="Two's Competition"
            title="Two's Pot"
            desc="Extra pot shared between anyone who scores 2 or lower on any hole"
            on={twosEnabled}
            setOn={setTwosEnabled}
          >
            <FeeInput currency={currency} value={twosFee} onChange={setTwosFee} />
          </Toggle>

          {/* ── NTP ────────────────────────────────────────────── */}
          <Toggle
            label="Nearest the Pin"
            title="NTP Pot"
            desc="Side pot for the closest tee shot to the pin on a par 3"
            on={ntpEnabled}
            setOn={setNtpEnabled}
          >
            <HolePicker
              label="Pick hole (par 3)"
              holes={par3s}
              selected={ntpHole}
              onSelect={setNtpHole}
              empty={course ? 'No par 3s found for this course' : 'Select a course to pick the hole'}
            />
            <FeeInput currency={currency} value={ntpFee} onChange={setNtpFee} />
          </Toggle>

          {/* ── LD ─────────────────────────────────────────────── */}
          <Toggle
            label="Longest Drive"
            title="Longest Drive Pot"
            desc="Side pot for the longest drive in the fairway on a par 5"
            on={ldEnabled}
            setOn={setLdEnabled}
          >
            <HolePicker
              label="Pick hole (par 5)"
              holes={par5s}
              selected={ldHole}
              onSelect={setLdHole}
              empty={course ? 'No par 5s found for this course' : 'Select a course to pick the hole'}
            />
            <FeeInput currency={currency} value={ldFee} onChange={setLdFee} />
          </Toggle>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/8 px-4 py-3 text-sm text-[var(--red)]">{error}</div>
        )}

        <div className="mt-8 flex gap-3">
          <Link
            href={`/swindle/${societyId}/manage`}
            className="flex items-center rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-3.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
          >
            Cancel
          </Link>
          <button
            onClick={create}
            disabled={!canCreate}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-3.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
          >
            <Coins size={15} />
            {saving ? 'Creating…' : 'Create Swindle'}
          </button>
        </div>
      </div>
    </div>
  );
}

function teeKey(t: Tee) { return `${t.tee_name}::${t.gender ?? ''}`; }

// ── Small building blocks ─────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">{label}</span>
        {hint && <span className="text-[10.5px] text-neutral-600">— {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Choice({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-3 text-center transition-colors ${
        active ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10' : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700'
      }`}
    >
      <div className={`text-sm font-bold ${active ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{label}</div>
      {sub && <div className={`mt-0.5 text-[10px] font-semibold ${active ? 'text-[var(--gold)]/70' : 'text-neutral-600'}`}>{sub}</div>}
    </button>
  );
}

function Toggle({
  label, title, desc, on, setOn, children,
}: {
  label: string; title: string; desc: string;
  on: boolean; setOn: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <Field label={label}>
      <div className={`flex items-center gap-4 rounded-xl border p-4 transition-colors ${
        on ? 'border-[var(--gold)]/30 bg-[var(--gold)]/5' : 'border-[#1c1c1c] bg-[#000000]'
      }`}>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold ${on ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{desc}</div>
        </div>
        <button
          type="button"
          onClick={() => setOn(!on)}
          aria-pressed={on}
          aria-label={title}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
            on ? 'bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))]' : 'bg-[#1c1c1c]'
          }`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {on && children && <div className="mt-3 space-y-3">{children}</div>}
    </Field>
  );
}

function HolePicker({
  label, holes, selected, onSelect, empty,
}: {
  label: string; holes: { hole_number: number }[]; selected: number | null;
  onSelect: (h: number) => void; empty: string;
}) {
  if (holes.length === 0) return <div className="text-[11px] font-semibold text-neutral-600">{empty}</div>;
  return (
    <div>
      <div className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {holes.map(h => (
          <button
            key={h.hole_number}
            type="button"
            onClick={() => onSelect(h.hole_number)}
            className={`h-10 w-10 rounded-lg border font-mono text-sm font-bold tabular-nums transition-colors ${
              selected === h.hole_number
                ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold-bright)]'
                : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700'
            }`}
          >
            {h.hole_number}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeeInput({ currency, value, onChange }: { currency: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-xs font-semibold text-neutral-400">Extra fee per player</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={`${currency}2`}
        className="w-24 rounded-lg border border-[#1c1c1c] bg-[#000000] px-3 py-2 text-right font-mono text-sm tabular-nums text-white placeholder-neutral-600 outline-none transition-colors focus:border-[var(--gold)]/50"
      />
    </div>
  );
}
