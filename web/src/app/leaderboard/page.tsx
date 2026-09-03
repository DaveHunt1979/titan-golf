'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';
import { Trophy, Users } from 'lucide-react';

interface KronosRow { playerId: string; name: string; total: number; holes: number; }
interface TeamRow { id: string; name: string; accent_color: string; played: number; w: number; h: number; l: number; pts: number; }

type Tab = 'kronos' | 'teams';

const MEDAL_COLORS: Record<number, string> = { 0: '#D4AF37', 1: '#C0C0C0', 2: '#CD7F32' };

const KRONOS_COLS = 'grid-cols-[2.5rem_1fr_5rem_5rem_6rem]';
const TEAM_COLS   = 'grid-cols-[2.5rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem_4rem]';

export default function LeaderboardPage() {
  const [tab, setTab]               = useState<Tab>('kronos');
  const [kronosRows, setKronosRows] = useState<KronosRow[]>([]);
  const [teamRows, setTeamRows]     = useState<TeamRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const supabase = createClient();

  async function load() {
    const [{ data: holes }, { data: players }, { data: matches }, { data: teams }, { data: kronosComps }] = await Promise.all([
      supabase.from('match_holes').select('player_id,stableford_pts,match_id'),
      supabase.from('players').select('id,display_name'),
      supabase.from('matches').select('*'),
      supabase.from('teams').select('*').order('sort_order'),
      supabase.from('competitions').select('id').eq('include_in_kronos', true),
    ]);

    // ── Kronos (individual Stableford totals) ──────────────────
    if (holes && players && matches) {
      const kronosCompIds = new Set((kronosComps ?? []).map((c: any) => c.id));
      const titanMatchIds = new Set(
        (matches as any[]).filter(m => m.competition_id && kronosCompIds.has(m.competition_id)).map(m => m.id)
      );
      const totals: Record<string, { total: number; holes: number }> = {};
      holes.forEach((h: any) => {
        if (h.stableford_pts != null && titanMatchIds.has(h.match_id)) {
          if (!totals[h.player_id]) totals[h.player_id] = { total: 0, holes: 0 };
          totals[h.player_id].total += h.stableford_pts;
          totals[h.player_id].holes += 1;
        }
      });
      setKronosRows(
        Object.entries(totals)
          .map(([pid, v]) => {
            const p = (players as any[]).find(x => x.id === pid);
            return { playerId: pid, name: p?.display_name ?? '—', total: v.total, holes: v.holes };
          })
          .sort((a, b) => b.total - a.total)
      );
    }

    // ── Team standings ─────────────────────────────────────────
    if (matches && teams) {
      const st: Record<string, { w: number; h: number; l: number; played: number }> = {};
      (teams as any[]).forEach(t => { st[t.id] = { w: 0, h: 0, l: 0, played: 0 }; });

      (matches as any[])
        .filter(m => m.status === 'complete' && m.home_team_id && m.away_team_id)
        .forEach(m => {
          const home = st[m.home_team_id]; const away = st[m.away_team_id];
          if (!home || !away) return;
          home.played++; away.played++;
          if (m.winner === 'home')      { home.w++; away.l++; }
          else if (m.winner === 'away') { away.w++; home.l++; }
          else                          { home.h++; away.h++; }
        });

      setTeamRows(
        (teams as any[]).map(t => ({
          id: t.id, name: t.name, accent_color: t.accent_color,
          ...(st[t.id] ?? { w: 0, h: 0, l: 0, played: 0 }),
          pts: (st[t.id]?.w ?? 0) * 2 + (st[t.id]?.h ?? 0),
        })).sort((a, b) => b.pts - a.pts || b.w - a.w)
      );
    }

    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const sub = supabase
      .channel('web-lb')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_holes' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, load)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-screen">
      {/* Ambient gold wash behind the header — same top-of-page treatment as the Locker Room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="border-b border-[#1c1c1c] px-6 py-10">
          <div className="mx-auto max-w-screen-lg">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-3 flex items-center gap-3">
                  <Image src="/titan-logo.png" alt="Titan Golf" width={40} height={40} className="opacity-90" />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#D4AF37]">Titan Golf</span>
                </div>
                <h1 className="text-[52px] font-black leading-[0.95] tracking-tight text-white">Leaderboard</h1>
                {lastUpdated && (
                  <p className="mt-3 inline-flex rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 font-mono text-[11px] tabular-nums text-neutral-500">
                    Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[#4ade80]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#4ade80]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />
                  Live
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-8 flex gap-2">
              {(['kronos', 'teams'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-5 py-2.5 text-[12.5px] font-black tracking-wide transition-all ${
                    tab === t
                      ? 'bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] text-[#181200] shadow-[0_0_28px_-8px_rgba(212,175,55,0.75)]'
                      : 'border border-[#1c1c1c] bg-[#0a0a0a] text-neutral-500 hover:border-[#D4AF37]/30 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {t === 'kronos' ? <Trophy size={13} /> : <Users size={13} />}
                    {t === 'kronos' ? 'Kronos Trophy' : 'Team Standings'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────────── */}
        <div className="mx-auto max-w-screen-lg px-6 py-10">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
              <p className="text-sm text-neutral-500">Loading scores…</p>
            </div>
          ) : tab === 'kronos' ? (
            <KronosTable rows={kronosRows} />
          ) : (
            <TeamsTable rows={teamRows} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── SectionHeading ──────────────────────────────────────────────
function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

// ── Rank badge ──────────────────────────────────────────────────
// Gold = leader, then silver/bronze; everyone else is a quiet hairline chip.
function RankBadge({ rank }: { rank: number }) {
  const color = MEDAL_COLORS[rank - 1];
  if (color) {
    return (
      <span
        className="flex h-7 w-7 items-center justify-center rounded-lg border font-mono text-[12.5px] font-black tabular-nums"
        style={{ borderColor: `${color}55`, backgroundColor: `${color}14`, color }}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#1c1c1c] bg-[#111111] font-mono text-[12.5px] font-bold tabular-nums text-neutral-600">
      {rank}
    </span>
  );
}

// ── Kronos Trophy table ─────────────────────────────────────────
function KronosTable({ rows }: { rows: KronosRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[#D4AF37] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
          <Trophy size={28} />
        </div>
        <h3 className="text-lg font-black text-white">No scores yet</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
          Enter some rounds on the app and they&apos;ll appear here instantly.
        </p>
      </div>
    );
  }

  const leader = rows[0]?.total ?? 0;

  return (
    <div>
      {/* Top 3 podium cards */}
      {rows.length >= 3 && (
        <div className="mb-9">
          <SectionHeading label="Podium" hint="Kronos Trophy" />
          <div className="grid grid-cols-3 items-end gap-4">
            {[rows[1], rows[0], rows[2]].map((r, visIdx) => {
              const rank = visIdx === 1 ? 1 : visIdx === 0 ? 2 : 3;
              const isLeader = rank === 1;
              const color = MEDAL_COLORS[rank - 1] ?? '#444';
              return (
                <div
                  key={r.playerId}
                  className={`relative flex flex-col items-center rounded-2xl border p-6 text-center transition-colors ${
                    isLeader
                      ? 'border-[#D4AF37]/45 bg-[#D4AF37]/6 shadow-[0_0_50px_-16px_rgba(212,175,55,0.75)]'
                      : 'border-[#1c1c1c] bg-[#111111] hover:border-neutral-800'
                  } ${visIdx === 1 ? 'order-2 py-8' : visIdx === 0 ? 'order-1' : 'order-3'}`}
                >
                  <div
                    className="mb-3 flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${color}20`, border: `1.5px solid ${color}` }}
                  >
                    <span className="font-mono text-[13px] font-black tabular-nums" style={{ color }}>{rank}</span>
                  </div>
                  <div className={`text-[17px] font-black leading-tight ${isLeader ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                    {r.name}
                  </div>
                  <div className={`mt-2.5 font-mono ${isLeader ? 'text-[46px] text-[var(--gold-bright)]' : 'text-[38px] text-neutral-300'} font-bold leading-none tabular-nums`}>
                    {r.total}
                  </div>
                  <div className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-neutral-600">pts</div>
                  <div className="mt-3 rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 font-mono text-[10.5px] tabular-nums text-neutral-500">
                    {r.holes} holes played
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full table */}
      <SectionHeading label="Standings" hint={`${rows.length} player${rows.length === 1 ? '' : 's'}`} />
      <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
        {/* Header */}
        <div className={`grid ${KRONOS_COLS} gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3`}>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">#</div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Player</div>
          <div className="text-right text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Holes</div>
          <div className="text-right text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Pts</div>
          <div className="text-right text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Behind</div>
        </div>

        {rows.map((r, i) => {
          const behind = i === 0 ? null : leader - r.total;
          return (
            <div
              key={r.playerId}
              className={`grid ${KRONOS_COLS} items-center gap-4 border-b border-[#1c1c1c] px-5 py-3.5 transition-colors last:border-0 hover:bg-white/3 ${
                i === 0 ? 'bg-[#D4AF37]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
              }`}
            >
              <RankBadge rank={i + 1} />
              <div className={`min-w-0 truncate text-sm font-bold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                {r.name}
              </div>
              <div className="text-right font-mono text-sm tabular-nums text-neutral-400">{r.holes}</div>
              <div className={`text-right font-mono text-[17px] font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                {r.total}
              </div>
              <div className="text-right">
                {behind === null ? (
                  <span className="inline-flex rounded-full bg-[#D4AF37]/10 px-2.5 py-1 text-[9.5px] font-black uppercase tracking-widest text-[#D4AF37]">
                    Leader
                  </span>
                ) : (
                  <span className="font-mono text-sm tabular-nums text-neutral-500">-{behind}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Team Standings table ────────────────────────────────────────
function TeamsTable({ rows }: { rows: TeamRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-3xl shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
          ⚔️
        </div>
        <h3 className="text-lg font-black text-white">No team matches yet</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
          Complete team matches and standings will update here in real time.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading label="Team Standings" hint={`${rows.length} team${rows.length === 1 ? '' : 's'}`} />
      <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
        <div className={`grid ${TEAM_COLS} gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3`}>
          {['#', 'Team', 'P', 'W', 'H', 'L', 'PTS'].map(h => (
            <div
              key={h}
              className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== '#' && h !== 'Team' ? 'text-center' : ''}`}
            >
              {h}
            </div>
          ))}
        </div>

        {rows.map((r, i) => (
          <div
            key={r.id}
            className={`grid ${TEAM_COLS} items-center gap-3 border-b border-[#1c1c1c] px-5 py-3.5 transition-colors last:border-0 hover:bg-white/3 ${
              i === 0 ? 'bg-[#D4AF37]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
            }`}
          >
            <RankBadge rank={i + 1} />
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.accent_color ?? '#666', boxShadow: `0 0 10px -1px ${r.accent_color ?? '#666'}` }}
              />
              <span className={`truncate text-sm font-bold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{r.name}</span>
            </div>
            <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{r.played}</div>
            <div className="text-center font-mono text-sm font-bold tabular-nums text-[#4ade80]">{r.w}</div>
            <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{r.h}</div>
            <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{r.l}</div>
            <div className={`text-center font-mono text-[17px] font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
              {r.pts}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
