'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';
import { Trophy, Users } from 'lucide-react';

interface KronosRow { playerId: string; name: string; total: number; holes: number; }
interface TeamRow { id: string; name: string; accent_color: string; played: number; w: number; h: number; l: number; pts: number; }

type Tab = 'kronos' | 'teams';

const MEDAL_COLORS: Record<number, string> = { 0: '#D4AF37', 1: '#C0C0C0', 2: '#CD7F32' };

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
    <div className="min-h-screen">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b border-[#1e2d3d] bg-[#070b10] px-6 py-10">
        <div className="mx-auto max-w-screen-lg">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Image src="/titan-logo.png" alt="Titan Golf" width={40} height={40} className="opacity-90" />
                <span className="text-xs font-black uppercase tracking-[0.3em] text-[#D4AF37]">Titan Golf</span>
              </div>
              <h1 className="text-5xl font-black tracking-tight text-white">Leaderboard</h1>
              {lastUpdated && (
                <p className="mt-2 text-xs text-slate-500">
                  Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-[#4ade80] animate-pulse" />
                <span className="text-xs font-bold text-[#4ade80]">LIVE</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-8 flex gap-2">
            {(['kronos', 'teams'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-lg px-5 py-2.5 text-sm font-bold transition-all ${
                  tab === t
                    ? 'bg-[#D4AF37] text-[#070b10] shadow-lg shadow-[#D4AF37]/20'
                    : 'border border-[#1e2d3d] text-slate-400 hover:border-[#D4AF37]/30 hover:text-white'
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
      <div className="mx-auto max-w-screen-lg px-6 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
            <p className="text-sm text-slate-500">Loading scores…</p>
          </div>
        ) : tab === 'kronos' ? (
          <KronosTable rows={kronosRows} />
        ) : (
          <TeamsTable rows={teamRows} />
        )}
      </div>
    </div>
  );
}

// ── Kronos Trophy table ─────────────────────────────────────────
function KronosTable({ rows }: { rows: KronosRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <Trophy size={48} className="text-[#D4AF37]/30" />
        <p className="text-lg font-bold text-white">No scores yet</p>
        <p className="text-sm text-slate-500">Enter some rounds on the app and they&apos;ll appear here instantly.</p>
      </div>
    );
  }

  const leader = rows[0]?.total ?? 0;

  return (
    <div>
      {/* Top 3 podium cards */}
      {rows.length >= 3 && (
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[rows[1], rows[0], rows[2]].map((r, visIdx) => {
            const rank = visIdx === 1 ? 1 : visIdx === 0 ? 2 : 3;
            const isLeader = rank === 1;
            return (
              <div
                key={r.playerId}
                className={`relative flex flex-col items-center rounded-2xl border p-6 text-center transition-all ${
                  isLeader
                    ? 'border-[#D4AF37]/50 bg-[#D4AF37]/8 shadow-xl shadow-[#D4AF37]/10 scale-105'
                    : 'border-[#1e2d3d] bg-[#0f1923]'
                } ${visIdx === 1 ? 'order-2' : visIdx === 0 ? 'order-1' : 'order-3'}`}
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full mx-auto" style={{ backgroundColor: `${MEDAL_COLORS[rank - 1] ?? '#333'}20`, border: `1.5px solid ${MEDAL_COLORS[rank - 1] ?? '#444'}` }}>
                  <span className="text-sm font-black" style={{ color: MEDAL_COLORS[rank - 1] ?? '#aaa' }}>{rank}</span>
                </div>
                <div className={`text-xl font-black ${isLeader ? 'text-[#D4AF37]' : 'text-white'}`}>{r.name}</div>
                <div className={`mt-2 text-4xl font-black ${isLeader ? 'text-[#D4AF37]' : 'text-slate-300'}`}>{r.total}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">pts</div>
                <div className="mt-3 text-xs text-slate-600">{r.holes} holes played</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full table */}
      <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
        {/* Header */}
        <div className="grid grid-cols-[2rem_1fr_5rem_5rem_6rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">#</div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Player</div>
          <div className="text-right text-xs font-bold uppercase tracking-widest text-slate-500">Holes</div>
          <div className="text-right text-xs font-bold uppercase tracking-widest text-slate-500">Pts</div>
          <div className="text-right text-xs font-bold uppercase tracking-widest text-slate-500">Behind</div>
        </div>

        {rows.map((r, i) => {
          const behind = i === 0 ? null : leader - r.total;
          return (
            <div
              key={r.playerId}
              className={`grid grid-cols-[2rem_1fr_5rem_5rem_6rem] gap-4 border-b border-[#1e2d3d] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
                i === 0 ? 'bg-[#D4AF37]/5' : 'bg-[#070b10]'
              }`}
            >
              <div className={`text-sm font-black ${i < 3 ? ['text-[#D4AF37]', 'text-slate-400', 'text-amber-600'][i] : 'text-slate-600'}`}>
                {i + 1}
              </div>
              <div className={`text-sm font-bold ${i === 0 ? 'text-[#D4AF37]' : 'text-white'}`}>{r.name}</div>
              <div className="text-right text-sm text-slate-400">{r.holes}</div>
              <div className={`text-right text-sm font-black ${i === 0 ? 'text-[#D4AF37]' : 'text-white'}`}>{r.total}</div>
              <div className="text-right text-sm text-slate-500">
                {behind === null ? <span className="text-[#D4AF37] font-bold text-xs">LEADER</span> : `-${behind}`}
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
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <div className="text-5xl">⚔️</div>
        <p className="text-lg font-bold text-white">No team matches yet</p>
        <p className="text-sm text-slate-500">Complete team matches and standings will update here in real time.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
      <div className="grid grid-cols-[2rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem_4rem] gap-3 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
        {['#', 'Team', 'P', 'W', 'H', 'L', 'PTS'].map(h => (
          <div key={h} className={`text-xs font-bold uppercase tracking-widest text-slate-500 ${h !== '#' && h !== 'Team' ? 'text-center' : ''}`}>{h}</div>
        ))}
      </div>

      {rows.map((r, i) => (
        <div
          key={r.id}
          className={`grid grid-cols-[2rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem_4rem] items-center gap-3 border-b border-[#1e2d3d] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
            i === 0 ? 'bg-[#D4AF37]/5' : 'bg-[#070b10]'
          }`}
        >
          <div className={`text-sm font-black ${i === 0 ? 'text-[#D4AF37]' : 'text-slate-500'}`}>{i + 1}</div>
          <div className="flex items-center gap-2.5">
            <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.accent_color ?? '#666' }} />
            <span className={`text-sm font-bold ${i === 0 ? 'text-[#D4AF37]' : 'text-white'}`}>{r.name}</span>
          </div>
          <div className="text-center text-sm text-slate-400">{r.played}</div>
          <div className="text-center text-sm font-semibold text-[#4ade80]">{r.w}</div>
          <div className="text-center text-sm text-slate-400">{r.h}</div>
          <div className="text-center text-sm text-slate-400">{r.l}</div>
          <div className={`text-center text-sm font-black ${i === 0 ? 'text-[#D4AF37]' : 'text-white'}`}>{r.pts}</div>
        </div>
      ))}
    </div>
  );
}
