'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const CATEGORY_COLOR: Record<string, string> = {
  wood: '#D4AF37',
  hybrid: '#8b5cf6',
  iron: '#3b82f6',
  wedge: '#f97316',
  putter: '#10b981',
};

interface ClubDistance { short: string; avg: number; count: number; category: string; }
interface ClubUsage { short: string; count: number; category: string; }
interface HandicapPoint { value: number; at: string; }

interface StatsData {
  totalRounds: number;
  totalShots: number;
  avgPuttsPerHole: number | null;
  distances: ClubDistance[];
  usage: ClubUsage[];
  scoring: { eagle: number; birdie: number; par: number; bogey: number; double: number; total: number };
  putting: { one: number; two: number; three: number; total: number };
  fairways: { left: number; centre: number; right: number; total: number };
  handicaps: HandicapPoint[];
}

export default function StatsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatsData | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/auth/login'); return; }

      const { data: player } = await supabase
        .from('players')
        .select('id')
        .eq('auth_uid', user.id)
        .maybeSingle();

      if (!player) { setLoading(false); return; }
      const pid = player.id;

      const [
        { data: distShots },
        { data: usageShots },
        { data: holeStats },
        { data: matchHoles },
        { data: handicaps },
      ] = await Promise.all([
        supabase.from('shots').select('club_short, distance_yards, clubs(short, category)').eq('player_id', pid).not('distance_yards', 'is', null),
        supabase.from('shots').select('club_id, clubs(short, category)').eq('player_id', pid),
        supabase.from('hole_stats').select('fairway_direction, fairway_hit, putts').eq('player_id', pid),
        supabase.from('match_holes').select('match_id, stableford_pts').eq('player_id', pid),
        supabase.from('handicap_history').select('handicap_index, calculated_at').eq('player_id', pid).order('calculated_at', { ascending: true }).limit(20),
      ]);

      // 1. Club distances
      const distAgg: Record<string, { sum: number; count: number; category: string }> = {};
      (distShots ?? []).forEach((s: any) => {
        const short = s.clubs?.short ?? s.club_short;
        if (!short || s.distance_yards == null) return;
        if (!distAgg[short]) distAgg[short] = { sum: 0, count: 0, category: s.clubs?.category ?? '' };
        distAgg[short].sum += s.distance_yards;
        distAgg[short].count += 1;
        if (s.clubs?.category) distAgg[short].category = s.clubs.category;
      });
      const distances: ClubDistance[] = Object.entries(distAgg)
        .map(([short, v]) => ({ short, avg: Math.round(v.sum / v.count), count: v.count, category: v.category }))
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 14);

      // 2. Club usage
      const usageAgg: Record<string, { count: number; category: string }> = {};
      (usageShots ?? []).forEach((s: any) => {
        const short = s.clubs?.short;
        if (!short) return;
        if (!usageAgg[short]) usageAgg[short] = { count: 0, category: s.clubs?.category ?? '' };
        usageAgg[short].count += 1;
      });
      const usage: ClubUsage[] = Object.entries(usageAgg)
        .map(([short, v]) => ({ short, count: v.count, category: v.category }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // 3. Fairway + putting from hole_stats
      const fairways = { left: 0, centre: 0, right: 0, total: 0 };
      const putting = { one: 0, two: 0, three: 0, total: 0 };
      let puttSum = 0;
      let puttHoleCount = 0;
      (holeStats ?? []).forEach((h: any) => {
        const dir = (h.fairway_direction ?? '').toLowerCase();
        if (dir === 'left') { fairways.left++; fairways.total++; }
        else if (dir === 'centre' || dir === 'center') { fairways.centre++; fairways.total++; }
        else if (dir === 'right') { fairways.right++; fairways.total++; }
        if (h.putts != null) {
          puttSum += h.putts;
          puttHoleCount++;
          putting.total++;
          if (h.putts <= 1) putting.one++;
          else if (h.putts === 2) putting.two++;
          else putting.three++;
        }
      });

      // 4. Scoring distribution from match_holes
      const scoring = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, total: 0 };
      const roundIds = new Set<string>();
      (matchHoles ?? []).forEach((h: any) => {
        if (h.match_id) roundIds.add(h.match_id);
        if (h.stableford_pts == null) return;
        scoring.total++;
        const pts = h.stableford_pts;
        if (pts >= 4) scoring.eagle++;
        else if (pts === 3) scoring.birdie++;
        else if (pts === 2) scoring.par++;
        else if (pts === 1) scoring.bogey++;
        else scoring.double++;
      });

      // 5. Handicaps
      const handicapPoints: HandicapPoint[] = (handicaps ?? [])
        .filter((h: any) => h.handicap_index != null)
        .map((h: any) => ({ value: h.handicap_index, at: h.calculated_at }));

      setData({
        totalRounds: roundIds.size,
        totalShots: (usageShots ?? []).length,
        avgPuttsPerHole: puttHoleCount ? puttSum / puttHoleCount : null,
        distances,
        usage,
        scoring,
        putting,
        fairways,
        handicaps: handicapPoints,
      });
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
        <p className="text-sm text-slate-500">Loading your stats…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-12">
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 text-4xl">📊</div>
          <h3 className="text-lg font-bold text-white">No profile found</h3>
          <p className="mt-1 text-sm text-slate-400">Open the Titan Golf app to set up your player profile.</p>
        </div>
      </div>
    );
  }

  const hasAnything =
    data.distances.length || data.usage.length || data.scoring.total || data.putting.total ||
    data.fairways.total || data.handicaps.length;

  const maxDist = data.distances.length ? Math.max(...data.distances.map(d => d.avg)) : 1;
  const maxUsage = data.usage.length ? Math.max(...data.usage.map(u => u.count)) : 1;

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="mb-10">
        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Your golf</div>
        <h1 className="mt-1 text-5xl font-black text-white">My Stats</h1>
        <p className="mt-2 text-slate-400">Club distances, scoring, putting and handicap trend.</p>
      </div>

      {!hasAnything ? (
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 text-4xl">📊</div>
          <h3 className="text-lg font-bold text-white">No stats yet</h3>
          <p className="mt-1 text-sm text-slate-400">Log some shots and rounds in the app to see your stats here.</p>
        </div>
      ) : (
        <div className="space-y-10">

          {/* ── Summary pills ────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total rounds', value: data.totalRounds },
              { label: 'Shots logged', value: data.totalShots },
              { label: 'Avg putts / hole', value: data.avgPuttsPerHole != null ? data.avgPuttsPerHole.toFixed(2) : '—' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
                <div className="text-3xl font-black text-white">{s.value}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          {/* ── Club Distances ───────────────────────────────── */}
          {data.distances.length > 0 && (
            <section>
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Club Distances</div>
              <div className="space-y-2.5 rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5">
                {data.distances.map(d => {
                  const color = CATEGORY_COLOR[d.category] ?? '#64748b';
                  return (
                    <div key={d.short} className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3">
                      <div className="text-sm font-bold text-white">{d.short}</div>
                      <div className="h-6 overflow-hidden rounded-md bg-[#070b10]">
                        <div
                          className="h-full rounded-md transition-all"
                          style={{ width: `${Math.max((d.avg / maxDist) * 100, 4)}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="text-right text-sm font-black text-white">{d.avg}<span className="ml-1 text-xs font-normal text-slate-500">yd</span></div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Club Usage ───────────────────────────────────── */}
          {data.usage.length > 0 && (
            <section>
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Club Usage</div>
              <div className="space-y-2.5 rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5">
                {data.usage.map(u => {
                  const color = CATEGORY_COLOR[u.category] ?? '#64748b';
                  return (
                    <div key={u.short} className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3">
                      <div className="text-sm font-bold text-white">{u.short}</div>
                      <div className="h-6 overflow-hidden rounded-md bg-[#070b10]">
                        <div
                          className="h-full rounded-md transition-all"
                          style={{ width: `${Math.max((u.count / maxUsage) * 100, 4)}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="text-right text-sm font-black text-white">{u.count}<span className="ml-1 text-xs font-normal text-slate-500">shots</span></div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Scoring Breakdown ────────────────────────────── */}
          {data.scoring.total > 0 && (
            <section>
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Scoring Breakdown</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  { label: 'Eagle+', value: data.scoring.eagle, color: '#D4AF37' },
                  { label: 'Birdie', value: data.scoring.birdie, color: '#4ade80' },
                  { label: 'Par', value: data.scoring.par, color: '#e2e8f0' },
                  { label: 'Bogey', value: data.scoring.bogey, color: '#f97316' },
                  { label: 'Dbl+', value: data.scoring.double, color: '#f87171' },
                ].map(s => {
                  const pct = data.scoring.total ? Math.round((s.value / data.scoring.total) * 100) : 0;
                  return (
                    <div key={s.label} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
                      <div className="text-3xl font-black" style={{ color: s.color }}>{s.value}</div>
                      <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{s.label}</div>
                      <div className="mt-1 text-xs text-slate-600">{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Putting ──────────────────────────────────────── */}
          {data.putting.total > 0 && (
            <section>
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Putting</div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: '1-putt', value: data.putting.one, color: '#4ade80' },
                  { label: '2-putt', value: data.putting.two, color: '#e2e8f0' },
                  { label: '3-putt+', value: data.putting.three, color: '#f87171' },
                ].map(p => {
                  const pct = data.putting.total ? Math.round((p.value / data.putting.total) * 100) : 0;
                  return (
                    <div key={p.label} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
                      <div className="text-3xl font-black" style={{ color: p.color }}>{p.value}</div>
                      <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{p.label}</div>
                      <div className="mt-1 text-xs text-slate-600">{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Fairway Accuracy ─────────────────────────────── */}
          {data.fairways.total > 0 && (
            <section>
              <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Fairway Accuracy</div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Left', value: data.fairways.left, highlight: false },
                  { label: 'Centre', value: data.fairways.centre, highlight: true },
                  { label: 'Right', value: data.fairways.right, highlight: false },
                ].map(f => {
                  const pct = data.fairways.total ? Math.round((f.value / data.fairways.total) * 100) : 0;
                  return (
                    <div
                      key={f.label}
                      className={`rounded-2xl border bg-[#0f1923] p-5 text-center ${
                        f.highlight ? 'border-[#4ade80]/40' : 'border-[#1e2d3d]'
                      }`}
                    >
                      <div className={`text-3xl font-black ${f.highlight ? 'text-[#4ade80]' : 'text-white'}`}>{f.value}</div>
                      <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{f.label}</div>
                      <div className={`mt-1 text-xs ${f.highlight ? 'font-bold text-[#4ade80]' : 'text-slate-600'}`}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Handicap Trend ───────────────────────────────── */}
          {data.handicaps.length > 0 && (
            <HandicapTrend points={data.handicaps} />
          )}

        </div>
      )}
    </div>
  );
}

// ── Handicap trend with inline SVG chart ────────────────────────
function HandicapTrend({ points }: { points: HandicapPoint[] }) {
  const start = points[0].value;
  const current = points[points.length - 1].value;
  const change = current - start;
  // Lower handicap = improving.
  const improving = change < 0;

  const W = 400;
  const H = 80;
  const PAD = 12;
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = points.length === 1
      ? W / 2
      : PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (p.value - min) / range) * (H - PAD * 2);
    return { x, y, value: p.value };
  });

  return (
    <section>
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Handicap Trend</div>
      <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6">
        <div className="mb-5 grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-black text-white">{start.toFixed(1)}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Start</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-black ${change === 0 ? 'text-slate-400' : improving ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {change === 0 ? '—' : `${improving ? '▼' : '▲'} ${Math.abs(change).toFixed(1)}`}
            </div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Change</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-black text-[#D4AF37]">{current.toFixed(1)}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Current</div>
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 100 }}>
          {coords.slice(1).map((c, i) => {
            const prev = coords[i];
            // Improving = handicap dropped from prev to current.
            const segImproving = c.value < prev.value;
            const segFlat = c.value === prev.value;
            const stroke = segFlat ? '#64748b' : segImproving ? '#4ade80' : '#f87171';
            return (
              <line
                key={i}
                x1={prev.x} y1={prev.y} x2={c.x} y2={c.y}
                stroke={stroke} strokeWidth={2} strokeLinecap="round"
              />
            );
          })}
          {coords.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={2.5} fill="#D4AF37" />
          ))}
        </svg>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>{start.toFixed(1)}</span>
          <span>{current.toFixed(1)}</span>
        </div>
      </div>
    </section>
  );
}
