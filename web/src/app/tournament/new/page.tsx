'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Copy, Check, Trophy, Minus, Plus } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type FormatId = 'team_matchplay' | 'titan_way' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';
type DayFormatId = 'four_bbb' | 'foursomes' | 'greensomes' | 'singles' | 'stableford' | 'medal' | 'scramble';

interface CompFormat {
  id: FormatId;
  label: string;
  sub: string;
  available: boolean;
  defaultDays: number;
  defaultDayFormat: DayFormatId;
  defaultHcp: number;
}

interface DayConfig {
  courseName: string;
  format: DayFormatId;
  hcpPct: number;
}

// ── Data ──────────────────────────────────────────────────────────────────────

// Mirrors src/lib/tournamentFormat.ts's FORMAT_RULES registry (Rick's
// brief, section 9, 2026-08-24) — this is a separate Next.js project so it
// can't import that file directly; keep these two in sync by hand whenever
// a format's identity/defaults change.
const COMP_FORMATS: CompFormat[] = [
  { id: 'team_matchplay', label: 'Multi-Team Tour',        sub: 'Multiple teams battle across days. Mix 4BBB, foursomes and singles. Titan Tour style.', available: true,  defaultDays: 4, defaultDayFormat: 'four_bbb',   defaultHcp: 75  },
  { id: 'titan_way',      label: 'Titan Way',              sub: '4BBB Stableford opening rounds build a team league, then a final-day knockout + singles draw — plus a full Kronos individual championship. Minimum 4 teams, 16 players.', available: true, defaultDays: 4, defaultDayFormat: 'four_bbb', defaultHcp: 75 },
  { id: 'ryder_cup',      label: 'Ryder Cup',              sub: '2 sides, captain picks, team points. Perfect for a weekend away.',                       available: true,  defaultDays: 3, defaultDayFormat: 'four_bbb',   defaultHcp: 75  },
  { id: 'stableford',     label: 'Individual Stableford',  sub: 'Everyone plays for themselves. Points per round build a season leaderboard.',             available: true,  defaultDays: 4, defaultDayFormat: 'stableford', defaultHcp: 100 },
  { id: 'medal',          label: 'Stroke Play',            sub: 'Lowest aggregate score wins. Multiple rounds, optional cut after round 2.',               available: true,  defaultDays: 2, defaultDayFormat: 'medal',      defaultHcp: 100 },
  { id: 'knockout',       label: 'Knockout Bracket',       sub: 'Seeded draw, head-to-head elimination rounds.',                                           available: false, defaultDays: 1, defaultDayFormat: 'singles',    defaultHcp: 75  },
];

const DAY_FORMATS: Array<{ id: DayFormatId; label: string; sub: string }> = [
  { id: 'four_bbb',   label: '4BBB',       sub: 'Best ball pairs'  },
  { id: 'foursomes',  label: 'Foursomes',  sub: 'Alternate shot'   },
  { id: 'greensomes', label: 'Greensomes', sub: 'Pick best drive'  },
  { id: 'singles',    label: 'Singles',    sub: '1v1 matchplay'    },
  { id: 'stableford', label: 'Stableford', sub: 'Points per hole'  },
  { id: 'medal',      label: 'Medal',      sub: 'Stroke play'      },
  { id: 'scramble',   label: 'Scramble',   sub: 'Team scramble'    },
];

const HCP_OPTIONS = [
  { pct: 100, label: 'Full (100%)' },
  { pct: 87,  label: '7/8 (87%)'  },
  { pct: 75,  label: '3/4 (75%)'  },
  { pct: 0,   label: 'Scratch'    },
];

const STEPS = ['Format', 'Details', 'Days', 'Review'];

function genPin() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewTournamentPage() {
  const [step,            setStep]            = useState(0);
  const [selectedFormat,  setSelectedFormat]  = useState<FormatId | null>(null);
  const [name,            setName]            = useState('');
  const [year,            setYear]            = useState(String(new Date().getFullYear() + 1));
  const [days,            setDays]            = useState<DayConfig[]>([]);
  const [includeInKronos, setIncludeInKronos] = useState(false);
  const [creating,        setCreating]        = useState(false);
  const [error,           setError]           = useState('');
  const [created,         setCreated]         = useState<{ name: string; pin: string } | null>(null);
  const [copied,          setCopied]          = useState(false);

  const formatDef = COMP_FORMATS.find(f => f.id === selectedFormat);

  function pickFormat(f: CompFormat) {
    if (!f.available) return;
    setSelectedFormat(f.id);
    setIncludeInKronos(f.id === 'team_matchplay' || f.id === 'titan_way');
    const built: DayConfig[] = Array.from({ length: f.defaultDays }, (_, i) => {
      const isLast  = i === f.defaultDays - 1;
      const isTour  = f.id === 'team_matchplay' || f.id === 'titan_way';
      return {
        courseName: '',
        format:     isLast && isTour ? 'singles'      : f.defaultDayFormat,
        hcpPct:     isLast && isTour ? 85             : f.defaultHcp,
      };
    });
    setDays(built);
    if (!name) setName(`${f.label} ${new Date().getFullYear() + 1}`);
  }

  function updateDay(i: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }

  function addDay() {
    if (days.length >= 10) return;
    setDays(prev => [...prev, { courseName: '', format: formatDef?.defaultDayFormat ?? 'four_bbb', hcpPct: formatDef?.defaultHcp ?? 75 }]);
  }

  function removeDay() {
    if (days.length <= 1) return;
    setDays(prev => prev.slice(0, -1));
  }

  const canNext = [
    selectedFormat !== null,
    name.trim().length >= 2,
    true,
  ][step] ?? true;

  async function create() {
    if (!selectedFormat || !name.trim()) return;
    setCreating(true); setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be logged in.'); setCreating(false); return; }

    const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setError('Player profile not found.'); setCreating(false); return; }

    const { data: member } = await supabase
      .from('society_members').select('role, society_id')
      .eq('player_id', player.id).in('role', ['admin', 'owner']).maybeSingle();
    if (!member) { setError('Admin access required.'); setCreating(false); return; }

    const pin = genPin();

    const settings = {
      format_type: selectedFormat,
      num_days: days.length,
      day_configs: days.map(d => ({ format: d.format, hcp_pct: d.hcpPct })),
      ...(selectedFormat === 'team_matchplay' || selectedFormat === 'titan_way' || selectedFormat === 'ryder_cup'
        ? { pts_win: 2, pts_win_singles: 3, pts_half: 1 }
        : {}),
    };

    // tournament_type was previously never written from here at all, so
    // every web-created competition silently defaulted to 'casual' and
    // permanently lost its Team leaderboard tab regardless of the format
    // actually picked (Rick's brief, section 9). Titan Way collapses into
    // 'titan_tour' here too, same as the mobile builder — this column can't
    // distinguish the two, only `format` can.
    const tournamentType = selectedFormat === 'ryder_cup'
      ? 'ryder_cup'
      : (selectedFormat === 'team_matchplay' || selectedFormat === 'titan_way') ? 'titan_tour' : 'casual';

    const { data: comp, error: compErr } = await supabase
      .from('competitions')
      .insert({ society_id: member.society_id, name: name.trim(), year: parseInt(year) || new Date().getFullYear() + 1, format: selectedFormat, tournament_type: tournamentType, status: 'draft', settings, include_in_kronos: includeInKronos, pin })
      .select().single();

    if (compErr || !comp) { setError(compErr?.message ?? 'Could not create competition.'); setCreating(false); return; }

    const dayRows = days.map((d, i) => ({ competition_id: comp.id, day_number: i + 1, course_name: d.courseName.trim() || null }));
    await supabase.from('competition_days').insert(dayRows);

    setCreating(false);
    setCreated({ name: name.trim(), pin });
  }

  function copyPin() {
    if (!created) return;
    navigator.clipboard.writeText(created.pin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
        />
        <div className="relative flex min-h-[70vh] items-center justify-center px-6 py-12">
          <div className="w-full max-w-lg text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[var(--gold-bright)] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
                <Trophy size={36} />
              </div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Tournament Created</div>
            <h1 className="mt-1.5 text-[40px] font-black leading-[0.95] tracking-tight text-white">{created.name}</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm text-neutral-400">
              Share this PIN with your players. They enter it in the Titan Golf app to unlock the Tour tab.
            </p>

            {/* Big PIN */}
            <div className="my-8 rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 p-8">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Tournament PIN</div>
              <div className="mt-3 font-mono text-[64px] font-bold leading-none tabular-nums tracking-[10px] text-[var(--gold-bright)]">
                {created.pin}
              </div>
              <button
                onClick={copyPin}
                className="mx-auto mt-6 flex items-center gap-2 rounded-full border border-[#D4AF37]/40 px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy PIN'}
              </button>
            </div>

            <div className="mb-8 flex justify-center">
              <span className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-500">
                Saved as a draft — activate it from the admin panel when you&apos;re ready
              </span>
            </div>

            <div className="flex justify-center gap-3">
              <Link
                href="/admin"
                className="rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-2.5 text-[12.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
              >
                Admin Panel
              </Link>
              <Link
                href="/tournament/archive"
                className="rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-6 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
              >
                View Archive →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      {/* Ambient gold wash behind the header — same top-of-page treatment as the Locker Room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-2xl px-6 py-12">

        {/* Header */}
        <div className="mb-8">
          <Link
            href="/tournament/archive"
            className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:text-[var(--gold-bright)]"
          >
            ← Back to Archive
          </Link>

          <div className="mt-5 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
            <div className="p-6">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">New Competition</div>
              <div className="mt-1.5 flex items-baseline justify-between gap-4">
                <h1 className="text-[40px] font-black leading-[0.95] tracking-tight text-white">{STEPS[step]}</h1>
                <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-widest tabular-nums text-neutral-600">
                  Step {step + 1} / {STEPS.length}
                </span>
              </div>
            </div>

            {/* Step indicator — gold for done/active, neutral for upcoming. */}
            <div className="border-t border-[#1c1c1c] bg-[#0a0a0a] px-6 py-4">
              <div className="flex items-center">
                {STEPS.map((label, i) => {
                  const done   = i < step;
                  const active = i === step;
                  return (
                    <div key={label} className="flex flex-1 items-center last:flex-none">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold tabular-nums transition-colors ${
                            active
                              ? 'border-[#D4AF37] bg-[#D4AF37]/12 text-[var(--gold-bright)] shadow-[0_0_18px_-4px_rgba(212,175,55,0.75)]'
                              : done
                                ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8 text-[#D4AF37]'
                                : 'border-[#1c1c1c] bg-[#111111] text-neutral-600'
                          }`}
                        >
                          {done ? <Check size={13} /> : i + 1}
                        </span>
                        <span
                          className={`hidden text-[10px] font-black uppercase tracking-[0.13em] sm:block ${
                            active ? 'text-[var(--gold-bright)]' : done ? 'text-neutral-400' : 'text-neutral-600'
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <span className={`mx-3 h-px flex-1 ${i < step ? 'bg-[#D4AF37]/40' : 'bg-[#1c1c1c]'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 0: Format ──────────────────────────────────── */}
        {step === 0 && (
          <div>
            <p className="mb-4 text-sm text-neutral-400">Pick the competition type. You can mix formats on different days.</p>
            <div className="space-y-3">
              {COMP_FORMATS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pickFormat(f)}
                  disabled={!f.available}
                  className={`w-full rounded-2xl border px-6 py-5 text-left transition-colors disabled:opacity-40 ${
                    selectedFormat === f.id
                      ? 'border-[#D4AF37]/50 bg-[#D4AF37]/8'
                      : 'border-[#1c1c1c] bg-[#111111] hover:border-neutral-700 hover:bg-[#1a1a1a]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 font-black ${selectedFormat === f.id ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{f.label}</div>
                    {!f.available && (
                      <span className="rounded-full border border-[#1c1c1c] bg-[#000000] px-2.5 py-1 text-[9.5px] font-black uppercase tracking-widest text-neutral-500">
                        Coming Soon
                      </span>
                    )}
                    {selectedFormat === f.id && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#D4AF37]/15 text-[var(--gold-bright)]">
                        <Check size={13} />
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">{f.sub}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 1: Details ─────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm text-neutral-400">Name it, set the year, and choose how many days you&apos;ll play.</p>

            <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
              <div className="mb-5">
                <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Competition Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Titan Tour 2027"
                  className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={e => setYear(e.target.value)}
                  min="2020" max="2040"
                  className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 font-mono text-sm tabular-nums text-white outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
              <label className="mb-3 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Number of Days</label>
              <div className="flex items-center gap-4">
                <button
                  onClick={removeDay}
                  disabled={days.length <= 1}
                  aria-label="Remove a day"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#1c1c1c] bg-[#000000] text-[#D4AF37] transition-colors hover:border-[#D4AF37]/40 hover:bg-[#D4AF37]/8 disabled:opacity-30 disabled:hover:border-[#1c1c1c] disabled:hover:bg-[#000000]"
                >
                  <Minus size={18} />
                </button>
                <span className="min-w-[6rem] text-center font-mono text-[26px] font-bold leading-none tabular-nums text-white">
                  {days.length}
                  <span className="ml-1.5 text-[12px] font-bold text-neutral-600">{days.length === 1 ? 'day' : 'days'}</span>
                </span>
                <button
                  onClick={addDay}
                  disabled={days.length >= 10}
                  aria-label="Add a day"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#1c1c1c] bg-[#000000] text-[#D4AF37] transition-colors hover:border-[#D4AF37]/40 hover:bg-[#D4AF37]/8 disabled:opacity-30 disabled:hover:border-[#1c1c1c] disabled:hover:bg-[#000000]"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>

            <div className={`flex items-center gap-4 rounded-2xl border p-5 transition-colors ${
              includeInKronos ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5' : 'border-[#1c1c1c] bg-[#111111]'
            }`}>
              <div className="flex-1">
                <div className={`font-bold ${includeInKronos ? 'text-[var(--gold-bright)]' : 'text-white'}`}>Include in Kronos Trophy</div>
                <div className="mt-0.5 text-sm text-neutral-500">Individual Stableford scores count toward the season leaderboard</div>
              </div>
              <button
                onClick={() => setIncludeInKronos(v => !v)}
                aria-pressed={includeInKronos}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  includeInKronos ? 'bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))]' : 'bg-[#1c1c1c]'
                }`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${includeInKronos ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Day Setup ───────────────────────────────── */}
        {step === 2 && (
          <div>
            <p className="mb-4 text-sm text-neutral-400">Set the course and format for each day. You can mix it up every year.</p>
            <div className="space-y-4">
              {days.map((day, i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
                  <div className="flex items-center gap-3 border-b border-[#1c1c1c] bg-[#0a0a0a] px-6 py-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/8 font-mono text-[11px] font-bold tabular-nums text-[var(--gold-bright)]">
                      {i + 1}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#D4AF37]">Day {i + 1}</span>
                    <span className="h-px flex-1 bg-[#1c1c1c]" />
                    <span className="text-[11px] font-semibold text-neutral-600">{day.hcpPct}% hcp</span>
                  </div>

                  <div className="p-6">
                    <div className="mb-5">
                      <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Course</label>
                      <input
                        value={day.courseName}
                        onChange={e => updateDay(i, { courseName: e.target.value })}
                        placeholder="e.g. West Cliffs"
                        className="w-full rounded-lg border border-[#1c1c1c] bg-[#000000] px-4 py-3 text-sm text-white placeholder-neutral-600 outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20"
                      />
                    </div>

                    <div className="mb-5">
                      <label className="mb-2 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Format</label>
                      <div className="flex flex-wrap gap-2">
                        {DAY_FORMATS.map(f => (
                          <button
                            key={f.id}
                            onClick={() => updateDay(i, { format: f.id })}
                            className={`rounded-xl border px-4 py-2 text-left text-sm transition-colors ${
                              day.format === f.id
                                ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10'
                                : 'border-[#1c1c1c] bg-[#000000] hover:border-neutral-700 hover:bg-[#111111]'
                            }`}
                          >
                            <div className={`font-bold ${day.format === f.id ? 'text-[var(--gold-bright)]' : 'text-neutral-300'}`}>{f.label}</div>
                            <div className={`text-[10px] ${day.format === f.id ? 'text-[#D4AF37]/70' : 'text-neutral-600'}`}>{f.sub}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Handicap Allowance</label>
                      <div className="grid grid-cols-4 gap-2">
                        {HCP_OPTIONS.map(h => (
                          <button
                            key={h.pct}
                            onClick={() => updateDay(i, { hcpPct: h.pct })}
                            className={`rounded-xl border py-2.5 text-xs font-bold transition-colors ${
                              day.hcpPct === h.pct
                                ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[var(--gold-bright)]'
                                : 'border-[#1c1c1c] bg-[#000000] text-neutral-400 hover:border-neutral-700 hover:bg-[#111111]'
                            }`}
                          >
                            {h.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3: Review ──────────────────────────────────── */}
        {step === 3 && (
          <div>
            <p className="mb-4 text-sm text-neutral-400">Review your setup. The tournament is created as a draft — activate it from admin when ready.</p>

            {/* Summary — hairline grid, same treatment as the dashboard stat tiles. */}
            <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3">
              {[
                { key: 'Format',  val: formatDef?.label ?? '—',                            gold: true  },
                { key: 'Name',    val: name.trim() || '—',                                 gold: false },
                { key: 'Year',    val: year,                                               gold: false },
                { key: 'Days',    val: String(days.length),                                gold: false },
                { key: 'Kronos',  val: includeInKronos ? '✓ Included' : 'Not included',    gold: includeInKronos },
              ].map(row => (
                <div key={row.key} className="bg-[#111111] px-4 py-3.5">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{row.key}</div>
                  <div className={`mt-1.5 truncate text-[15px] font-bold leading-tight ${row.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                    {row.val}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-6 overflow-hidden rounded-2xl border border-[#1c1c1c]">
              <div className="grid grid-cols-[4.5rem_1fr_5rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                {['Day', 'Course & Format', 'Hcp'].map(h => (
                  <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h === 'Hcp' ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              {days.map((d, i) => {
                const fmt = DAY_FORMATS.find(f => f.id === d.format);
                return (
                  <div
                    key={i}
                    className={`grid grid-cols-[4.5rem_1fr_5rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-4 last:border-0 ${
                      i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                    }`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-[0.13em] text-[#D4AF37]">Day {i + 1}</span>
                    <span className="min-w-0 truncate text-sm text-neutral-300">
                      <span className="font-semibold text-white">{d.courseName || 'TBC'}</span>
                      <span className="text-neutral-600"> · </span>
                      {fmt?.label}
                    </span>
                    <span className="text-center font-mono text-sm font-bold tabular-nums text-[var(--gold-bright)]">{d.hcpPct}%</span>
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-[#f87171]/30 bg-[#f87171]/8 px-4 py-3 text-sm text-[#f87171]">{error}</div>
            )}
          </div>
        )}

        {/* ── Footer nav ──────────────────────────────────────── */}
        <div className="mt-8 flex gap-3">
          {step === 0 ? (
            <Link
              href="/tournament/archive"
              className="flex items-center rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-3.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
            >
              Cancel
            </Link>
          ) : (
            <button
              onClick={() => setStep(s => s - 1)}
              className="rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-3.5 text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
            >
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canNext}
              className="flex-1 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-3.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={create}
              disabled={creating}
              className="flex-1 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] py-3.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
            >
              {creating ? 'Creating…' : 'Create Tournament'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
