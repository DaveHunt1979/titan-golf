'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useSeasonAdmin } from '@/lib/season/useSeasonAdmin';
import { Minus, Plus, X } from 'lucide-react';

// Mirrors app/(app)/admin/season-create.tsx field for field, including the
// defaults — a Season created here must be indistinguishable from one
// created in the app.

interface DivisionRow { name: string; targetSize: string }
interface MajorRow { name: string; startDate: string; endDate: string }

const DEFAULT_DIVISIONS: DivisionRow[] = [
  { name: 'Premier League', targetSize: '20' },
  { name: 'Championship',   targetSize: '20' },
  { name: 'League One',     targetSize: '20' },
  { name: 'League Two',     targetSize: '20' },
];

// Spec §11.4 recommended branding — four fixed slots, multiplier is always 1.5.
const DEFAULT_MAJORS: MajorRow[] = [
  { name: 'Titan Masters',             startDate: '', endDate: '' },
  { name: 'Titan Championship',        startDate: '', endDate: '' },
  { name: 'Titan Open',                startDate: '', endDate: '' },
  { name: 'Titan Season Championship', startDate: '', endDate: '' },
];

/** 6-digit join PIN, auto-generated exactly as the app does. */
function genPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** yyyy-mm-dd (the native date input's value) → an ISO timestamp. */
function dateToIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

export default function SeasonCreatePage() {
  const router = useRouter();
  const supabase = createClient();
  const { loading: gateLoading, societyId, societyName } = useSeasonAdmin();

  const currentYear = new Date().getFullYear();
  const [name, setName]                 = useState(`Titan Season ${currentYear}`);
  const [seasonYear, setSeasonYear]     = useState(currentYear);
  const [regCloseDate, setRegCloseDate] = useState(`${currentYear}-01-01`);
  const [startDate, setStartDate]       = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate]           = useState(`${currentYear}-12-31`);

  const [divisions, setDivisions]                     = useState<DivisionRow[]>(DEFAULT_DIVISIONS);
  const [promotionPlaces, setPromotionPlaces]         = useState(3);
  const [relegationPlaces, setRelegationPlaces]       = useState(3);
  const [minQualifyingRounds, setMinQualifyingRounds] = useState(20);
  const [handicapAllowance, setHandicapAllowance]     = useState(100);
  const [majors, setMajors]                           = useState<MajorRow[]>(DEFAULT_MAJORS);

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  function updateDivision(i: number, field: keyof DivisionRow, value: string) {
    setDivisions(prev => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }
  function addDivision() {
    setDivisions(prev => [...prev, { name: `Division ${prev.length + 1}`, targetSize: '20' }]);
  }
  function removeDivision(i: number) {
    if (divisions.length <= 1) return;
    setDivisions(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateMajor(i: number, field: keyof MajorRow, value: string) {
    setMajors(prev => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  }

  const canCreate = name.trim().length > 0
    && divisions.length > 0
    && divisions.every(d => d.name.trim().length > 0 && Number(d.targetSize) > 0)
    && majors.every(m => m.name.trim().length > 0 && m.startDate && m.endDate);

  async function createSeason() {
    if (!societyId || !canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const { data: season, error: seasonErr } = await supabase
        .from('seasons')
        .insert({
          society_id: societyId,
          name: name.trim(),
          season_year: seasonYear,
          registration_close_at: dateToIso(regCloseDate),
          start_at: dateToIso(startDate),
          end_at: dateToIso(endDate),
          minimum_qualifying_rounds: minQualifyingRounds,
          counting_round_limit: minQualifyingRounds,
          handicap_allowance_percent: handicapAllowance,
          join_pin: genPin(),
          status: 'draft',
        })
        .select('id')
        .single();
      if (seasonErr || !season) throw seasonErr ?? new Error('Season insert failed');
      const seasonId = (season as { id: string }).id;

      // Spec §6.1 — top division: no promotion; bottom division: no relegation.
      const { error: divErr } = await supabase.from('season_divisions').insert(
        divisions.map((d, i) => ({
          season_id: seasonId,
          name: d.name.trim(),
          display_order: i,
          target_player_count: Number(d.targetSize),
          promotion_places: i === 0 ? 0 : promotionPlaces,
          relegation_places: i === divisions.length - 1 ? 0 : relegationPlaces,
        })),
      );
      if (divErr) throw divErr;

      const { error: majorErr } = await supabase.from('season_majors').insert(
        majors.map((m, i) => ({
          season_id: seasonId,
          sequence: i + 1,
          name: m.name.trim(),
          start_at: dateToIso(m.startDate),
          end_at: dateToIso(m.endDate),
          multiplier: 1.5,
          status: 'scheduled',
        })),
      );
      if (majorErr) throw majorErr;

      router.push('/season');
    } catch (e) {
      setError((e as Error)?.message ?? 'Could not create Season');
      setSaving(false);
    }
  }

  if (gateLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--green)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/season" className="text-sm text-[var(--gold)] hover:underline">← Back to Seasons</Link>

      <div className="mb-8 mt-6">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--green)]">
          {societyName ?? 'Society'} · Season Mode
        </div>
        <h1 className="mt-1 text-5xl font-black text-white">Create Season</h1>
        <p className="mt-2 text-neutral-400">
          Created as a draft — a 6-digit join PIN is generated automatically, and players join instantly with it.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--red)]/30 bg-[#111111] px-5 py-3 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      {/* ── Basics ─────────────────────────────────────────────── */}
      <SectionHeading label="Basics" />
      <div className="mb-8 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
        <FieldLabel htmlFor="season-name">Season Name</FieldLabel>
        <input
          id="season-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={`e.g. Titan Season ${currentYear + 1}`}
          className={INPUT}
        />

        <FieldLabel>Season Year</FieldLabel>
        <Stepper
          value={String(seasonYear)}
          onDec={() => setSeasonYear(y => y - 1)}
          onInc={() => setSeasonYear(y => y + 1)}
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div>
            <FieldLabel htmlFor="reg-close" tight>Registration Closes</FieldLabel>
            <input id="reg-close" type="date" value={regCloseDate} onChange={e => setRegCloseDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <FieldLabel htmlFor="start-at" tight>Season Start</FieldLabel>
            <input id="start-at" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <FieldLabel htmlFor="end-at" tight>Season End</FieldLabel>
            <input id="end-at" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={INPUT} />
          </div>
        </div>
      </div>

      {/* ── Divisions ──────────────────────────────────────────── */}
      <SectionHeading label="Divisions" />
      <div className="mb-8 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
        <div className="mb-2 grid grid-cols-[1fr_6rem_2.5rem] gap-3">
          <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Division</span>
          <span className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Target Size</span>
          <span />
        </div>
        {divisions.map((d, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_6rem_2.5rem] items-center gap-3">
            <input
              value={d.name}
              onChange={e => updateDivision(i, 'name', e.target.value)}
              placeholder="Division name"
              aria-label={`Division ${i + 1} name`}
              className={INPUT}
            />
            <input
              value={d.targetSize}
              onChange={e => updateDivision(i, 'targetSize', e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="20"
              aria-label={`Division ${i + 1} target size`}
              className={`${INPUT} text-center font-mono tabular-nums`}
            />
            <button
              onClick={() => removeDivision(i)}
              disabled={divisions.length <= 1}
              aria-label={`Remove division ${i + 1}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:text-[var(--red)] disabled:pointer-events-none disabled:opacity-30"
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          onClick={addDivision}
          className="mt-2 w-full rounded-xl border-[1.5px] border-dashed border-[#2a2a2a] py-3 text-xs font-bold text-neutral-400 transition-colors hover:border-[var(--green)]/50 hover:text-[var(--green)]"
        >
          <Plus size={13} className="mr-1 inline" />
          Add Division
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">
          Divisions fill from the lowest handicaps down — the top division gets no promotion places and the
          bottom division gets no relegation places, applied automatically.
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <FieldLabel tight>Promoted</FieldLabel>
            <Stepper
              value={String(promotionPlaces)}
              onDec={() => setPromotionPlaces(v => Math.max(0, v - 1))}
              onInc={() => setPromotionPlaces(v => v + 1)}
            />
          </div>
          <div>
            <FieldLabel tight>Relegated</FieldLabel>
            <Stepper
              value={String(relegationPlaces)}
              onDec={() => setRelegationPlaces(v => Math.max(0, v - 1))}
              onInc={() => setRelegationPlaces(v => v + 1)}
            />
          </div>
        </div>
      </div>

      {/* ── Qualification ──────────────────────────────────────── */}
      <SectionHeading label="Qualification" />
      <div className="mb-8 grid gap-6 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6 sm:grid-cols-2">
        <div>
          <FieldLabel tight>Minimum / Best-X Qualifying Rounds</FieldLabel>
          <Stepper
            value={`${minQualifyingRounds} rounds`}
            onDec={() => setMinQualifyingRounds(v => Math.max(1, v - 1))}
            onInc={() => setMinQualifyingRounds(v => v + 1)}
          />
        </div>
        <div>
          <FieldLabel tight>Handicap Allowance</FieldLabel>
          <Stepper
            value={`${handicapAllowance}%`}
            onDec={() => setHandicapAllowance(v => Math.max(0, v - 5))}
            onInc={() => setHandicapAllowance(v => Math.min(150, v + 5))}
          />
        </div>
      </div>

      {/* ── Majors ─────────────────────────────────────────────── */}
      <SectionHeading label="The 4 Majors" hint="1.5× multiplier" />
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {majors.map((m, i) => (
          <div key={i} className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-[var(--green)]">Major {i + 1}</div>
            <input
              value={m.name}
              onChange={e => updateMajor(i, 'name', e.target.value)}
              placeholder="Major name"
              aria-label={`Major ${i + 1} name`}
              className={`${INPUT} mt-2`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="date"
                value={m.startDate}
                onChange={e => updateMajor(i, 'startDate', e.target.value)}
                aria-label={`Major ${i + 1} start date`}
                className={INPUT}
              />
              <input
                type="date"
                value={m.endDate}
                onChange={e => updateMajor(i, 'endDate', e.target.value)}
                aria-label={`Major ${i + 1} end date`}
                className={INPUT}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={createSeason}
        disabled={!canCreate || saving}
        className="w-full rounded-xl bg-[var(--green)] py-4 text-sm font-black text-[#00140a] transition-[filter] hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
      >
        {saving ? 'Creating…' : 'Create Season (Draft)'}
      </button>
      <p className="mt-3 text-center text-[11px] text-neutral-600">
        Registration, publishing divisions and closing the Season all happen from the Seasons list.
      </p>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

const INPUT =
  'w-full rounded-xl border border-[#1c1c1c] bg-[#000000] px-4 py-2.5 text-sm font-semibold text-white outline-none transition-colors placeholder:text-neutral-700 hover:border-neutral-700 focus:border-[var(--green)]/40';

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--green)]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

function FieldLabel({ children, htmlFor, tight }: { children: React.ReactNode; htmlFor?: string; tight?: boolean }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500 ${tight ? 'mb-1.5' : 'mb-1.5 mt-6 first:mt-0'}`}
    >
      {children}
    </label>
  );
}

function Stepper({ value, onDec, onInc }: { value: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onDec}
        aria-label="Decrease"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1c1c1c] bg-[#000000] text-[var(--green)] transition-colors hover:border-[var(--green)]/40"
      >
        <Minus size={15} />
      </button>
      <span className="min-w-[6.5rem] text-center font-mono text-sm font-bold tabular-nums text-white">{value}</span>
      <button
        onClick={onInc}
        aria-label="Increase"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1c1c1c] bg-[#000000] text-[var(--green)] transition-colors hover:border-[var(--green)]/40"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
