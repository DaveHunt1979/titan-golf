import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Flag, ChevronRight } from 'lucide-react';

interface RoundSummary {
  id: string;
  courseName: string;
  playDate: string | null;
  dayNumber: number | null;
  coursePar: number | null;
  holesPlayed: number;
  grossTotal: number;
  stablefordTotal: number;
  toPar: number | null;
  fairwaysHit: number;
  fairwaysTracked: number;
  avgPutts: number | null;
}

export default async function RoundsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players')
    .select('id, display_name')
    .eq('auth_uid', user.id)
    .maybeSingle();

  const pid = player?.id;

  const { data: matches } = pid
    ? await supabase
        .from('matches')
        .select('id, status, day:day_id(course_name, course_par, play_date, day_number)')
        .or(`home_player_ids.cs.{${pid}},away_player_ids.cs.{${pid}}`)
        .eq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: null };

  const matchIds = (matches ?? []).map((m: any) => m.id);

  const [{ data: holes }, { data: stats }] = matchIds.length && pid
    ? await Promise.all([
        supabase
          .from('match_holes')
          .select('match_id, gross_score, stableford_pts')
          .in('match_id', matchIds)
          .eq('player_id', pid),
        supabase
          .from('hole_stats')
          .select('match_id, fairway_hit, putts')
          .in('match_id', matchIds)
          .eq('player_id', pid),
      ])
    : [{ data: null }, { data: null }];

  const rounds: RoundSummary[] = (matches ?? [])
    .map((m: any): RoundSummary => {
      const mh = (holes ?? []).filter((h: any) => h.match_id === m.id);
      const ms = (stats ?? []).filter((s: any) => s.match_id === m.id);
      const holesPlayed = mh.filter((h: any) => h.gross_score != null).length;
      const grossTotal = mh.reduce((s: number, h: any) => s + (h.gross_score ?? 0), 0);
      const stablefordTotal = mh.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0);
      const coursePar = m.day?.course_par ?? null;
      const fairwaysTracked = ms.filter((s: any) => s.fairway_hit != null).length;
      const fairwaysHit = ms.filter((s: any) => s.fairway_hit === true).length;
      const puttRows = ms.filter((s: any) => s.putts != null);
      const totalPutts = puttRows.reduce((s: number, r: any) => s + (r.putts ?? 0), 0);
      return {
        id: m.id,
        courseName: m.day?.course_name ?? 'Unknown course',
        playDate: m.day?.play_date ?? null,
        dayNumber: m.day?.day_number ?? null,
        coursePar,
        holesPlayed,
        grossTotal,
        stablefordTotal,
        toPar: holesPlayed === 18 && coursePar != null ? grossTotal - coursePar : null,
        fairwaysHit,
        fairwaysTracked,
        avgPutts: puttRows.length ? totalPutts / puttRows.length : null,
      };
    })
    .filter((r: RoundSummary) => r.holesPlayed > 0);

  const bestStableford = rounds.length ? Math.max(...rounds.map(r => r.stablefordTotal)) : null;

  // Summary tiles — derived from the rounds already loaded above, no extra query.
  const avgStableford = rounds.length
    ? Math.round(rounds.reduce((s, r) => s + r.stablefordTotal, 0) / rounds.length)
    : null;
  const totalFairwaysHit     = rounds.reduce((s, r) => s + r.fairwaysHit, 0);
  const totalFairwaysTracked = rounds.reduce((s, r) => s + r.fairwaysTracked, 0);
  const fairwayPctAll = totalFairwaysTracked
    ? Math.round((totalFairwaysHit / totalFairwaysTracked) * 100)
    : null;
  const puttRounds = rounds.filter(r => r.avgPutts != null);
  const avgPuttsAll = puttRounds.length
    ? puttRounds.reduce((s, r) => s + (r.avgPutts ?? 0), 0) / puttRounds.length
    : null;

  const statTiles: { label: string; value: string | number; suffix?: string; gold?: boolean }[] = [
    { label: 'Rounds',        value: rounds.length },
    { label: 'Best Points',   value: bestStableford ?? '—', suffix: bestStableford != null ? 'pts' : undefined, gold: true },
    { label: 'Avg Points',    value: avgStableford  ?? '—', suffix: avgStableford  != null ? 'pts' : undefined },
    { label: 'Fairways',      value: fairwayPctAll != null ? fairwayPctAll : '—', suffix: fairwayPctAll != null ? '%' : undefined, gold: true },
    { label: 'Putts / Hole',  value: avgPuttsAll != null ? avgPuttsAll.toFixed(2) : '—' },
  ];

  function fmtDate(d: string | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtToPar(v: number | null) {
    if (v == null) return '—';
    if (v === 0) return 'E';
    return v > 0 ? `+${v}` : `${v}`;
  }

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
              <Flag size={30} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Your golf</div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">Round History</h1>
              <p className="mt-2.5 text-sm text-neutral-400">Every completed round with full scorecard totals.</p>
            </div>
            {rounds.length > 0 && (
              <div className="shrink-0 rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] px-4 py-3 text-center sm:self-start">
                <div className="text-[10px] font-black uppercase tracking-widest text-neutral-600">Logged</div>
                <div className="mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--gold-bright)]">
                  {rounds.length}
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
                  {rounds.length === 1 ? 'round' : 'rounds'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Summary tiles ────────────────────────────────────── */}
        {rounds.length > 0 && (
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3 lg:grid-cols-5">
            {statTiles.map(s => (
              <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                  {s.value}
                  {s.suffix && <span className="ml-1 text-[12px] font-bold text-neutral-600">{s.suffix}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {rounds.length === 0 ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              <Flag size={26} />
            </div>
            <h3 className="text-lg font-black text-white">No completed rounds yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
              Finish a round in the Titan Golf app and it will appear here.
            </p>
          </div>
        ) : (
          <>
            <SectionHeading label="All Rounds" hint={`${rounds.length} complete`} />
            <div className="overflow-x-auto rounded-2xl border border-[#1c1c1c]">
              {/* Header */}
              <div className="grid min-w-[58rem] grid-cols-[1fr_7rem_4rem_5rem_5rem_5rem_6rem_5rem_2rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Course</div>
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Date</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Holes</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Gross</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">To Par</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Pts</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Fairway</div>
                <div className="text-center text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Putts</div>
                <div />
              </div>

              {rounds.map((r, i) => {
                const isLeader = bestStableford != null && r.stablefordTotal === bestStableford;
                const fairwayPct = r.fairwaysTracked
                  ? Math.round((r.fairwaysHit / r.fairwaysTracked) * 100)
                  : null;
                return (
                  <Link
                    key={r.id}
                    href={`/rounds/${r.id}`}
                    className={`group grid min-w-[58rem] grid-cols-[1fr_7rem_4rem_5rem_5rem_5rem_6rem_5rem_2rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-4 transition-colors last:border-0 hover:bg-white/5 ${
                      isLeader ? 'bg-[#D4AF37]/5' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-sm font-semibold ${isLeader ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                          {r.courseName}
                        </span>
                        {isLeader && (
                          <span className="shrink-0 rounded-full bg-[#D4AF37]/10 px-2 py-0.5 text-[9.5px] font-black uppercase tracking-widest text-[var(--gold-bright)]">
                            Best
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {r.dayNumber && <span className="text-xs text-neutral-500">Day {r.dayNumber}</span>}
                        <span className="inline-flex items-center rounded-full border border-[#1c1c1c] bg-[#000000] px-2 py-0.5 text-[9.5px] font-black uppercase tracking-widest text-neutral-500">
                          Complete
                        </span>
                      </div>
                    </div>
                    <div className="font-mono text-[12.5px] tabular-nums text-neutral-400">{fmtDate(r.playDate)}</div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{r.holesPlayed}</div>
                    <div className="text-center font-mono text-sm font-bold tabular-nums text-white">{r.grossTotal || '—'}</div>
                    <div className={`text-center font-mono text-sm font-bold tabular-nums ${
                      r.toPar == null ? 'text-neutral-600' : r.toPar <= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'
                    }`}>
                      {fmtToPar(r.toPar)}
                    </div>
                    <div className="text-center font-mono text-sm font-bold tabular-nums text-[var(--gold-bright)]">
                      {r.stablefordTotal || '—'}
                    </div>
                    <div className="text-center">
                      {fairwayPct == null ? (
                        <span className="font-mono text-sm tabular-nums text-neutral-600">—</span>
                      ) : (
                        <>
                          <div className="font-mono text-sm font-bold tabular-nums text-white">{fairwayPct}%</div>
                          <div className="font-mono text-[10px] tabular-nums text-neutral-600">{r.fairwaysHit}/{r.fairwaysTracked}</div>
                        </>
                      )}
                    </div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">
                      {r.avgPutts == null ? '—' : r.avgPutts.toFixed(1)}
                    </div>
                    <div className="flex justify-end">
                      <ChevronRight size={16} className="text-neutral-700 transition-colors group-hover:text-[var(--gold-bright)]" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
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
