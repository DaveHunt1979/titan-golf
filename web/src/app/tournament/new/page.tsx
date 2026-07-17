'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { Copy, Check, Trophy } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type FormatId = 'team_matchplay' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';
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

const COMP_FORMATS: CompFormat[] = [
  { id: 'team_matchplay', label: 'Multi-Team Tour',        sub: 'Multiple teams battle across days. Mix 4BBB, foursomes and singles. Titan Tour style.', available: true,  defaultDays: 4, defaultDayFormat: 'four_bbb',   defaultHcp: 75  },
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
    setIncludeInKronos(f.id === 'team_matchplay');
    const built: DayConfig[] = Array.from({ length: f.defaultDays }, (_, i) => {
      const isLast  = i === f.defaultDays - 1;
      const isTour  = f.id === 'team_matchplay';
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
      ...(selectedFormat === 'team_matchplay' || selectedFormat === 'ryder_cup'
        ? { pts_win: 2, pts_win_singles: 3, pts_half: 1 }
        : {}),
    };

    const { data: comp, error: compErr } = await supabase
      .from('competitions')
      .insert({ society_id: member.society_id, name: name.trim(), year: parseInt(year) || new Date().getFullYear() + 1, format: selectedFormat, status: 'draft', settings, include_in_kronos: includeInKronos, pin })
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
      <div className="flex min-h-[70vh] items-center justify-center px-6">
        <div className="w-full max-w-lg text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10">
              <Trophy size={36} className="text-[#D4AF37]" />
            </div>
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Tournament Created</div>
          <h1 className="mt-2 text-4xl font-black text-white">{created.name}</h1>
          <p className="mt-3 text-slate-400">Share this PIN with your players. They enter it in the Titan Golf app to unlock the Tour tab.</p>

          {/* Big PIN */}
          <div className="my-8 rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 p-8">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Tournament PIN</div>
            <div className="mt-3 text-7xl font-black tracking-[12px] text-[#D4AF37]">{created.pin}</div>
            <button
              onClick={copyPin}
              className="mt-5 flex items-center gap-2 mx-auto rounded-lg border border-[#D4AF37]/40 px-5 py-2.5 text-sm font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied!' : 'Copy PIN'}
            </button>
          </div>

          <p className="mb-8 text-xs text-slate-500">
            The tournament is saved as a draft. Activate it from the admin panel when you're ready to start.
          </p>

          <div className="flex gap-3 justify-center">
            <Link href="/admin" className="rounded-xl border border-[#1e2d3d] px-6 py-3 text-sm font-bold text-slate-300 transition-colors hover:text-white">
              Admin Panel
            </Link>
            <Link href="/tournament/archive" className="rounded-xl bg-[#D4AF37] px-6 py-3 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90">
              View Archive →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">

      {/* Header */}
      <div className="mb-8">
        <Link href="/tournament/archive" className="text-sm text-[#D4AF37] hover:underline">← Back to Archive</Link>

        {/* Progress bar */}
        <div className="mt-6 flex gap-2">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= step ? 'bg-[#D4AF37]' : 'bg-[#1e2d3d]'}`} />
          ))}
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <h1 className="text-4xl font-black text-white">{STEPS[step]}</h1>
          <span className="text-xs font-bold text-slate-500">Step {step + 1} of {STEPS.length}</span>
        </div>
      </div>

      {/* ── Step 0: Format ──────────────────────────────────── */}
      {step === 0 && (
        <div>
          <p className="mb-6 text-slate-400">Pick the competition type. You can mix formats on different days.</p>
          <div className="space-y-3">
            {COMP_FORMATS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => pickFormat(f)}
                disabled={!f.available}
                className={`w-full rounded-2xl border px-6 py-5 text-left transition-all disabled:opacity-40 ${
                  selectedFormat === f.id
                    ? 'border-[#D4AF37]/50 bg-[#D4AF37]/8'
                    : 'border-[#1e2d3d] bg-[#0f1923] hover:border-[#D4AF37]/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex-1 font-black ${selectedFormat === f.id ? 'text-[#D4AF37]' : 'text-white'}`}>{f.label}</div>
                  {!f.available && (
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Coming Soon
                    </span>
                  )}
                  {selectedFormat === f.id && (
                    <span className="text-sm font-black text-[#D4AF37]">✓</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-400">{f.sub}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1: Details ─────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <p className="text-slate-400">Name it, set the year, and choose how many days you'll play.</p>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Competition Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Titan Tour 2027"
              className="w-full rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-4 py-3 text-white placeholder-slate-600 focus:border-[#D4AF37]/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Year</label>
            <input
              type="number"
              value={year}
              onChange={e => setYear(e.target.value)}
              min="2020" max="2040"
              className="w-full rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-4 py-3 text-white focus:border-[#D4AF37]/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-widest text-slate-400">Number of Days</label>
            <div className="flex items-center gap-4">
              <button
                onClick={removeDay}
                disabled={days.length <= 1}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#1e2d3d] bg-[#0f1923] text-2xl font-black text-[#D4AF37] disabled:opacity-30 hover:border-[#D4AF37]/30"
              >
                –
              </button>
              <span className="min-w-[6rem] text-center text-2xl font-black text-white">
                {days.length} {days.length === 1 ? 'day' : 'days'}
              </span>
              <button
                onClick={addDay}
                disabled={days.length >= 10}
                className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#1e2d3d] bg-[#0f1923] text-2xl font-black text-[#D4AF37] disabled:opacity-30 hover:border-[#D4AF37]/30"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-[#1e2d3d] bg-[#0f1923] p-4">
            <div className="flex-1">
              <div className="font-bold text-white">Include in Kronos Trophy</div>
              <div className="mt-0.5 text-sm text-slate-400">Individual Stableford scores count toward the season leaderboard</div>
            </div>
            <button
              onClick={() => setIncludeInKronos(v => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors ${includeInKronos ? 'bg-[#D4AF37]' : 'bg-[#1e2d3d]'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${includeInKronos ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Day Setup ───────────────────────────────── */}
      {step === 2 && (
        <div>
          <p className="mb-6 text-slate-400">Set the course and format for each day. You can mix it up every year.</p>
          <div className="space-y-6">
            {days.map((day, i) => (
              <div key={i} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6">
                <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Day {i + 1}</div>

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Course</label>
                  <input
                    value={day.courseName}
                    onChange={e => updateDay(i, { courseName: e.target.value })}
                    placeholder="e.g. West Cliffs"
                    className="w-full rounded-xl border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-[#D4AF37]/40 focus:outline-none"
                  />
                </div>

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Format</label>
                  <div className="flex flex-wrap gap-2">
                    {DAY_FORMATS.map(f => (
                      <button
                        key={f.id}
                        onClick={() => updateDay(i, { format: f.id })}
                        className={`rounded-xl border px-4 py-2 text-sm transition-all ${
                          day.format === f.id
                            ? 'border-[#D4AF37] bg-[#D4AF37] font-bold text-[#070b10]'
                            : 'border-[#1e2d3d] bg-[#070b10] text-slate-300 hover:border-[#D4AF37]/30'
                        }`}
                      >
                        <div className="font-bold">{f.label}</div>
                        <div className={`text-[10px] ${day.format === f.id ? 'text-[#070b10]/60' : 'text-slate-500'}`}>{f.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Handicap Allowance</label>
                  <div className="grid grid-cols-4 gap-2">
                    {HCP_OPTIONS.map(h => (
                      <button
                        key={h.pct}
                        onClick={() => updateDay(i, { hcpPct: h.pct })}
                        className={`rounded-xl border py-2.5 text-xs font-bold transition-all ${
                          day.hcpPct === h.pct
                            ? 'border-[#D4AF37]/50 bg-[#D4AF37]/10 text-[#D4AF37]'
                            : 'border-[#1e2d3d] bg-[#070b10] text-slate-400 hover:border-[#D4AF37]/20'
                        }`}
                      >
                        {h.label}
                      </button>
                    ))}
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
          <p className="mb-6 text-slate-400">Review your setup. The tournament is created as a draft — activate it from admin when ready.</p>

          <div className="mb-4 overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] divide-y divide-[#1e2d3d]">
            {[
              { key: 'Format',  val: formatDef?.label ?? '—' },
              { key: 'Name',    val: name.trim() || '—' },
              { key: 'Year',    val: year },
              { key: 'Days',    val: String(days.length) },
              { key: 'Kronos',  val: includeInKronos ? '✓ Included' : 'Not included' },
            ].map(row => (
              <div key={row.key} className="flex items-center gap-6 px-6 py-4">
                <span className="w-20 text-xs font-bold uppercase tracking-widest text-slate-500">{row.key}</span>
                <span className="flex-1 font-semibold text-white">{row.val}</span>
              </div>
            ))}
          </div>

          <div className="mb-6 overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] divide-y divide-[#1e2d3d]">
            {days.map((d, i) => {
              const fmt = DAY_FORMATS.find(f => f.id === d.format);
              return (
                <div key={i} className="flex items-center gap-6 px-6 py-4">
                  <span className="w-20 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Day {i + 1}</span>
                  <span className="flex-1 text-sm text-slate-300">
                    {d.courseName || 'TBC'} · {fmt?.label} · {d.hcpPct}% hcp
                  </span>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
          )}
        </div>
      )}

      {/* ── Footer nav ──────────────────────────────────────── */}
      <div className="mt-8 flex gap-3">
        {step === 0 ? (
          <Link href="/tournament/archive" className="rounded-xl border border-[#1e2d3d] px-6 py-4 text-sm font-bold text-slate-400 hover:text-white">
            Cancel
          </Link>
        ) : (
          <button onClick={() => setStep(s => s - 1)} className="rounded-xl border border-[#1e2d3d] px-6 py-4 text-sm font-bold text-slate-400 transition-colors hover:text-white">
            ← Back
          </button>
        )}
        {step < 3 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canNext}
            className="flex-1 rounded-xl bg-[#D4AF37] py-4 font-black text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Next →
          </button>
        ) : (
          <button
            onClick={create}
            disabled={creating}
            className="flex-1 rounded-xl bg-[#D4AF37] py-4 font-black text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Tournament'}
          </button>
        )}
      </div>
    </div>
  );
}
