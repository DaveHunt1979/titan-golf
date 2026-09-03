'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BarChart2 } from 'lucide-react';

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
        <p className="text-sm text-neutral-500">Loading your stats…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-12">
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
            <BarChart2 size={26} />
          </div>
          <h3 className="text-lg font-black text-white">No profile found</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">Open the Titan Golf app to set up your player profile.</p>
        </div>
      </div>
    );
  }

  const hasAnything =
    data.distances.length || data.usage.length || data.scoring.total || data.putting.total ||
    data.fairways.total || data.handicaps.length;

  const maxDist = data.distances.length ? Math.max(...data.distances.map(d => d.avg)) : 1;
  const maxUsage = data.usage.length ? Math.max(...data.usage.map(u => u.count)) : 1;

  const summaryTiles: { label: string; value: string | number; gold?: boolean }[] = [
    { label: 'Total Rounds',     value: data.totalRounds, gold: true },
    { label: 'Shots Logged',     value: data.totalShots },
    { label: 'Avg Putts / Hole', value: data.avgPuttsPerHole != null ? data.avgPuttsPerHole.toFixed(2) : '—', gold: true },
  ];

  return (
    <div className="relative">
      {/* Ambient gold wash behind the header — same top-of-page treatment as the command deck. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

        {/* ── Header ───────────────────────────────────────────── */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:text-left">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              <BarChart2 size={30} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Your golf</div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">My Stats</h1>
              <p className="mt-2.5 text-sm text-neutral-400">Club distances, scoring, putting and handicap trend.</p>
            </div>
          </div>
        </div>

        {!hasAnything ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              <BarChart2 size={26} />
            </div>
            <h3 className="text-lg font-black text-white">No stats yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">Log some shots and rounds in the app to see your stats here.</p>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── Summary tiles ──────────────────────────────── */}
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3">
              {summaryTiles.map(s => (
                <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                  <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Club Distances ───────────────────────────────── */}
            {data.distances.length > 0 && (
              <section>
                <SectionHeading label="Club Distances" hint={`Top ${data.distances.length} by carry`} />
                <div className="space-y-2 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
                  {data.distances.map(d => {
                    const color = CATEGORY_COLOR[d.category] ?? '#888888';
                    return (
                      <div
                        key={d.short}
                        className="grid grid-cols-[3rem_1fr_4.5rem_4rem] items-center gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/3"
                      >
                        <div className="font-mono text-[12.5px] font-bold uppercase tabular-nums text-white">{d.short}</div>
                        <div className="h-6 overflow-hidden rounded-md bg-[#000000]">
                          <div
                            className="h-full rounded-md transition-all"
                            style={{
                              width: `${Math.max((d.avg / maxDist) * 100, 4)}%`,
                              backgroundImage: `linear-gradient(90deg, ${color}55, ${color})`,
                            }}
                          />
                        </div>
                        <div className="text-right font-mono text-[15px] font-bold tabular-nums text-white">
                          {d.avg}<span className="ml-1 text-[10px] font-bold text-neutral-600">yd</span>
                        </div>
                        <div className="text-right font-mono text-[10.5px] tabular-nums text-neutral-600">{d.count} shots</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Club Usage ───────────────────────────────────── */}
            {data.usage.length > 0 && (
              <section>
                <SectionHeading label="Club Usage" hint={`${data.totalShots} shots logged`} />
                <div className="space-y-2 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
                  {data.usage.map(u => {
                    const color = CATEGORY_COLOR[u.category] ?? '#888888';
                    return (
                      <div
                        key={u.short}
                        className="grid grid-cols-[3rem_1fr_5.5rem] items-center gap-3 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/3"
                      >
                        <div className="font-mono text-[12.5px] font-bold uppercase tabular-nums text-white">{u.short}</div>
                        <div className="h-6 overflow-hidden rounded-md bg-[#000000]">
                          <div
                            className="h-full rounded-md transition-all"
                            style={{
                              width: `${Math.max((u.count / maxUsage) * 100, 4)}%`,
                              backgroundImage: `linear-gradient(90deg, ${color}55, ${color})`,
                            }}
                          />
                        </div>
                        <div className="text-right font-mono text-[15px] font-bold tabular-nums text-white">
                          {u.count}<span className="ml-1 text-[10px] font-bold text-neutral-600">shots</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Scoring Breakdown ────────────────────────────── */}
            {data.scoring.total > 0 && (
              <section>
                <SectionHeading label="Scoring Breakdown" hint={`${data.scoring.total} holes scored`} />
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-5">
                  {[
                    { label: 'Eagle+', value: data.scoring.eagle, color: '#D4AF37' },
                    { label: 'Birdie', value: data.scoring.birdie, color: '#4ade80' },
                    { label: 'Par', value: data.scoring.par, color: '#f5f5f5' },
                    { label: 'Bogey', value: data.scoring.bogey, color: '#f97316' },
                    { label: 'Dbl+', value: data.scoring.double, color: '#f87171' },
                  ].map(s => {
                    const pct = data.scoring.total ? Math.round((s.value / data.scoring.total) * 100) : 0;
                    return <ShareTile key={s.label} label={s.label} value={s.value} pct={pct} color={s.color} />;
                  })}
                </div>
              </section>
            )}

            {/* ── Putting ──────────────────────────────────────── */}
            {data.putting.total > 0 && (
              <section>
                <SectionHeading label="Putting" hint={`${data.putting.total} holes tracked`} />
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3">
                  {[
                    { label: '1-putt', value: data.putting.one, color: '#4ade80' },
                    { label: '2-putt', value: data.putting.two, color: '#f5f5f5' },
                    { label: '3-putt+', value: data.putting.three, color: '#f87171' },
                  ].map(p => {
                    const pct = data.putting.total ? Math.round((p.value / data.putting.total) * 100) : 0;
                    return <ShareTile key={p.label} label={p.label} value={p.value} pct={pct} color={p.color} />;
                  })}
                </div>
              </section>
            )}

            {/* ── Fairway Accuracy ─────────────────────────────── */}
            {data.fairways.total > 0 && (
              <section>
                <SectionHeading label="Fairway Accuracy" hint={`${data.fairways.total} tee shots tracked`} />
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3">
                  {[
                    { label: 'Left', value: data.fairways.left, highlight: false },
                    { label: 'Centre', value: data.fairways.centre, highlight: true },
                    { label: 'Right', value: data.fairways.right, highlight: false },
                  ].map(f => {
                    const pct = data.fairways.total ? Math.round((f.value / data.fairways.total) * 100) : 0;
                    return (
                      <ShareTile
                        key={f.label}
                        label={f.label}
                        value={f.value}
                        pct={pct}
                        color={f.highlight ? '#4ade80' : '#f5f5f5'}
                        highlight={f.highlight}
                      />
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
    </div>
  );
}

// ── SectionHeading ────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

// ── ShareTile ─────────────────────────────────────────────────────────────────
// Hairline stat tile: the count, the share it represents, and a bar for that share.
// Same numbers as before (count + %), just read as one tile.

function ShareTile({ label, value, pct, color, highlight = false }: {
  label: string; value: number; pct: number; color: string; highlight?: boolean;
}) {
  return (
    <div className={`px-4 py-3.5 ${highlight ? 'bg-[#4ade80]/5' : 'bg-[#111111]'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{label}</span>
        <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color: highlight ? color : '#737373' }}>
          {pct}%
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#000000]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Handicap trend with inline SVG chart ────────────────────────
// Same data and the same per-segment improving/worsening colouring as before,
// drawn with the Locker Room recipe: grid lines, a gradient area fill under the
// line, and the newest point emphasised.
function HandicapTrend({ points }: { points: HandicapPoint[] }) {
  const start = points[0].value;
  const current = points[points.length - 1].value;
  const change = current - start;
  // Lower handicap = improving.
  const improving = change < 0;

  const W = 400;
  const H = 132;
  const PAD = 14;
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

  // Area fill takes the colour of the overall direction; flat falls back to teal.
  const fillColor = change === 0 ? 'var(--teal)' : improving ? '#4ade80' : '#f87171';
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${H - PAD} L${coords[0].x.toFixed(1)},${H - PAD} Z`;

  const summary: { label: string; value: string; cls: string }[] = [
    { label: 'Start',   value: start.toFixed(1), cls: 'text-white' },
    {
      label: 'Change',
      value: change === 0 ? '—' : `${improving ? '▼' : '▲'} ${Math.abs(change).toFixed(1)}`,
      cls: change === 0 ? 'text-neutral-400' : improving ? 'text-[#4ade80]' : 'text-[#f87171]',
    },
    { label: 'Current', value: current.toFixed(1), cls: 'text-[var(--gold-bright)]' },
  ];

  return (
    <section>
      <SectionHeading label="Handicap Trend" hint={`${points.length} record${points.length === 1 ? '' : 's'}`} />
      <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">

        <div className="grid grid-cols-3 gap-px bg-[#1c1c1c]">
          {summary.map(s => (
            <div key={s.label} className="bg-[#111111] px-4 py-3.5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
              <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="p-6">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="aspect-[400/132] w-full overflow-visible"
          >
            <defs>
              <linearGradient id="hcpTrendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={fillColor} stopOpacity="0.26" />
                <stop offset="100%" stopColor={fillColor} stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0.25, 0.5, 0.75].map(f => {
              const y = PAD + (H - PAD * 2) * f;
              return <line key={f} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#1c1c1c" strokeWidth={1} />;
            })}

            {coords.length > 1 && <path d={fillPath} fill="url(#hcpTrendGrad)" />}

            {coords.slice(1).map((c, i) => {
              const prev = coords[i];
              // Improving = handicap dropped from prev to current.
              const segImproving = c.value < prev.value;
              const segFlat = c.value === prev.value;
              const stroke = segFlat ? '#888888' : segImproving ? '#4ade80' : '#f87171';
              return (
                <line
                  key={i}
                  x1={prev.x} y1={prev.y} x2={c.x} y2={c.y}
                  stroke={stroke} strokeWidth={2.2} strokeLinecap="round"
                />
              );
            })}

            {coords.map((c, i) => {
              const isLast = i === coords.length - 1;
              return (
                <circle
                  key={i}
                  cx={c.x} cy={c.y} r={isLast ? 4.5 : 2.8}
                  fill={isLast ? '#D4AF37' : '#0a0a0a'}
                  stroke={isLast ? '#0a0a0a' : '#D4AF37'}
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          <div className="mt-2 flex justify-between font-mono text-[9.5px] tabular-nums text-neutral-600">
            <span>{start.toFixed(1)}</span>
            <span>{current.toFixed(1)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
