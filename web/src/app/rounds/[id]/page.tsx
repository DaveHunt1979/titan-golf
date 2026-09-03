import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ArrowLeft } from 'lucide-react';

const GOLD     = '#D4AF37';
const GREEN    = '#4ade80';
const RED      = '#f87171';
const BLUE     = '#3b82f6';
const DARKBLUE = '#1e3a8a';
const PLAIN    = '#ffffff';

// Gross strokes vs par only — same classification used everywhere else in the app
// (handicap shots affect Stableford points, not the eagle/birdie/par/bogey label).
function scoreVsPar(gross: number, par: number): 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' {
  const diff = gross - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0)  return 'par';
  if (diff === 1)  return 'bogey';
  return 'double';
}
const SCORE_COLORS: Record<string, string> = { eagle: GOLD, birdie: RED, par: PLAIN, bogey: BLUE, double: DARKBLUE };

function ptsColor(pts: number): string {
  if (pts >= 4) return GOLD;
  if (pts === 3) return RED;
  if (pts === 2) return PLAIN;
  if (pts === 1) return BLUE;
  return DARKBLUE;
}

function vsParLabel(v: number): string {
  if (v <= -2) return 'Eagle+';
  if (v === -1) return 'Birdie';
  if (v === 0)  return 'Par';
  if (v === 1)  return 'Bogey';
  if (v === 2)  return 'Double';
  return 'Triple+';
}

export default async function RoundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players').select('id, display_name').eq('auth_uid', user.id).maybeSingle();
  if (!player) redirect('/auth/login');
  const pid = player.id;

  const { data: match } = await supabase
    .from('matches')
    .select('id, status, round_format, holes_to_play, home_player_ids, away_player_ids, day:day_id(course_name, course_par, play_date, day_number)')
    .eq('id', id)
    .maybeSingle();

  if (!match) notFound();
  const m = match as any;
  const involved = [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])].includes(pid);
  if (!involved) notFound();

  const courseName = m.day?.course_name ?? 'Unknown course';
  const isStableford = m.round_format === 'stableford';
  const holesToPlay = m.holes_to_play ?? 18;

  const [{ data: holes }, { data: stats }, { data: courseHoles }] = await Promise.all([
    supabase
      .from('match_holes')
      .select('hole_number, gross_score, net_score, stableford_pts')
      .eq('match_id', id)
      .eq('player_id', pid)
      .not('gross_score', 'is', null)
      .order('hole_number'),
    supabase
      .from('hole_stats')
      .select('fairway_hit, putts')
      .eq('match_id', id)
      .eq('player_id', pid),
    m.day?.course_name
      ? supabase.from('course_holes').select('hole_number, par, stroke_index').eq('course_name', m.day.course_name).order('hole_number')
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const parByHole: Record<number, number> = {};
  // stroke_index was already selected above — surfaced as the scorecard's SI row.
  const siByHole: Record<number, number | null> = {};
  for (const c of (courseHoles ?? []) as any[]) {
    parByHole[c.hole_number] = c.par;
    siByHole[c.hole_number] = c.stroke_index ?? null;
  }
  const hasStrokeIndex = Object.values(siByHole).some(v => v != null);

  const scored = (holes ?? []) as { hole_number: number; gross_score: number; net_score: number | null; stableford_pts: number | null }[];
  const holesWithPar = scored.map(h => ({ ...h, par: parByHole[h.hole_number] ?? 0, vsPar: h.gross_score - (parByHole[h.hole_number] ?? 0) }));

  const grossTotal = scored.reduce((s, h) => s + h.gross_score, 0);
  const ptsTotal    = scored.reduce((s, h) => s + (h.stableford_pts ?? 0), 0);
  const parPlayed   = holesWithPar.reduce((s, h) => s + h.par, 0);
  const vsPar       = grossTotal - parPlayed;

  const eagles  = holesWithPar.filter(h => h.vsPar <= -2).length;
  const birdies = holesWithPar.filter(h => h.vsPar === -1).length;
  const pars    = holesWithPar.filter(h => h.vsPar === 0).length;
  const bogeys  = holesWithPar.filter(h => h.vsPar === 1).length;
  const doubles = holesWithPar.filter(h => h.vsPar >= 2).length;

  const bestHole  = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar < b.vsPar ? h : b) : null;
  const worstHole = holesWithPar.length ? holesWithPar.reduce((b, h) => h.vsPar > b.vsPar ? h : b) : null;

  const statRows = (stats ?? []) as { fairway_hit: boolean | null; putts: number | null }[];
  const fairwaysTracked = statRows.filter(s => s.fairway_hit != null).length;
  const fairwaysHit     = statRows.filter(s => s.fairway_hit === true).length;
  const puttRows        = statRows.filter(s => s.putts != null);
  const avgPutts        = puttRows.length ? puttRows.reduce((s, r) => s + (r.putts ?? 0), 0) / puttRows.length : null;

  const finalScore = isStableford ? `${ptsTotal} pts` : `${vsPar >= 0 ? '+' : ''}${vsPar}`;
  const scoreColor = isStableford ? GOLD : (vsPar < 0 ? GREEN : vsPar > 5 ? RED : '#ffffff');

  const front9 = Array.from({ length: 9 },  (_, i) => i + 1).filter(n => parByHole[n] != null || scored.some(s => s.hole_number === n));
  const back9  = Array.from({ length: 9 },  (_, i) => i + 10).filter(n => parByHole[n] != null || scored.some(s => s.hole_number === n));
  const halves = [front9, back9].filter(h => h.length > 0);

  function fmtDate(d: string | null | undefined) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Round tiles — every number the page already computed, as one hairline grid.
  const roundTiles: { label: string; value: string | number; suffix?: string; gold?: boolean }[] = [
    { label: 'Gross',   value: grossTotal || '—', gold: true },
    ...(isStableford ? [{ label: 'Points', value: ptsTotal, suffix: 'pts', gold: true }] : []),
    { label: 'To Par',  value: parPlayed ? `${vsPar >= 0 ? '+' : ''}${vsPar}` : '—' },
    { label: 'Holes',   value: scored.length },
    ...(fairwaysTracked > 0
      ? [{ label: 'Fairways', value: `${Math.round((fairwaysHit / fairwaysTracked) * 100)}`, suffix: '%' }]
      : []),
    ...(avgPutts != null ? [{ label: 'Putts / Hole', value: avgPutts.toFixed(1) }] : []),
  ];

  const scoreTiles = [
    { n: eagles,  label: 'Eagles',  color: GOLD },
    { n: birdies, label: 'Birdies', color: RED },
    { n: pars,    label: 'Pars',    color: PLAIN },
    { n: bogeys,  label: 'Bogeys',  color: BLUE },
    { n: doubles, label: 'Dbl+',    color: DARKBLUE },
  ];

  const metaChips = [
    fmtDate(m.day?.play_date),
    m.day?.day_number ? `Day ${m.day.day_number}` : null,
    holesToPlay < 18 ? `${holesToPlay} holes` : null,
    isStableford ? 'Stableford' : 'Medal',
    fairwaysTracked > 0 ? `FWY ${fairwaysHit}/${fairwaysTracked}` : null,
    avgPutts != null ? `${avgPutts.toFixed(1)} putts / hole` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative">
      {/* Ambient gold wash behind the hero — same top-of-page treatment as the command deck. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-lg px-6 py-12">
        <Link href="/rounds" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-400 transition-colors hover:text-[var(--gold-bright)]">
          <ArrowLeft size={16} /> Round History
        </Link>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:text-left">

            <div className="flex h-[96px] w-[96px] shrink-0 items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
              <Trophy size={40} style={{ color: GOLD }} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Round Card</div>
              <h1 className="mt-1.5 text-[36px] font-black leading-[0.98] tracking-tight text-white">{courseName}</h1>
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {metaChips.map(chip => (
                  <span
                    key={chip}
                    className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* Headline score */}
            <div className="shrink-0 rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] px-5 py-4 text-center sm:self-start">
              <div className="text-[10px] font-black uppercase tracking-widest text-neutral-600">
                {isStableford ? 'Points' : 'To Par'}
              </div>
              <div className="mt-1.5 font-mono text-[38px] font-black leading-none tabular-nums" style={{ color: scoreColor }}>
                {finalScore}
              </div>
              <div className="mt-1.5 font-mono text-[11px] font-semibold tabular-nums text-neutral-500">
                {isStableford ? `${grossTotal} gross · ${ptsTotal} pts` : `${grossTotal} gross`}
              </div>
            </div>
          </div>
        </div>

        {/* ── Round tiles ───────────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-3 lg:grid-cols-6">
          {roundTiles.map(t => (
            <div key={t.label} className="bg-[#111111] px-4 py-3.5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{t.label}</div>
              <div className={`mt-1.5 font-mono text-[24px] font-bold leading-none tabular-nums ${t.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                {t.value}
                {t.suffix && <span className="ml-1 text-[12px] font-bold text-neutral-600">{t.suffix}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* ── Scoring breakdown ─────────────────────────────────── */}
        <div className="mt-8">
          <SectionHeading label="Scoring" hint={`${scored.length} holes scored`} />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-5">
            {scoreTiles.map(s => (
              <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                <div className="mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums" style={{ color: s.color }}>
                  {s.n}
                </div>
              </div>
            ))}
          </div>

          {/* Best / Worst */}
          {bestHole && worstHole && bestHole.hole_number !== worstHole.hole_number && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#4ade80]/25 bg-[#4ade80]/5 px-5 py-4">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Best Hole</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[#4ade80]">
                    {bestHole.hole_number}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#4ade80]">
                    {vsParLabel(bestHole.vsPar)}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-[#f87171]/25 bg-[#f87171]/5 px-5 py-4">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Worst Hole</div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[#f87171]">
                    {worstHole.hole_number}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#f87171]">
                    {vsParLabel(worstHole.vsPar)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Hole-by-hole scorecard ───────────────────────────── */}
        {halves.length > 0 && (
          <div className="mt-8">
            <SectionHeading label="Scorecard" hint="Hole by hole" />
            <div className="overflow-x-auto rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
              {halves.map((half, hi) => {
                const label = hi === 0 ? 'OUT' : 'IN';
                const halfPar = half.reduce((s, n) => s + (parByHole[n] ?? 0), 0);
                const halfScores = scored.filter(s => half.includes(s.hole_number));
                const halfGross = halfScores.reduce((s, h) => s + h.gross_score, 0);
                const halfPts = halfScores.reduce((s, h) => s + (h.stableford_pts ?? 0), 0);
                return (
                  <div key={hi} className={hi === 1 ? 'mt-5 border-t border-[#1c1c1c] pt-5' : ''}>
                    <div
                      className="grid min-w-[34rem] items-center gap-y-1.5 tabular-nums"
                      style={{ gridTemplateColumns: `4rem repeat(${half.length}, minmax(0,1fr)) 3.5rem` }}
                    >
                      {/* Hole numbers */}
                      <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Hole</div>
                      {half.map(n => (
                        <div
                          key={n}
                          className={`text-center font-mono text-[11.5px] font-bold tabular-nums ${
                            scored.some(s => s.hole_number === n) ? 'text-white' : 'text-neutral-700'
                          }`}
                        >
                          {n}
                        </div>
                      ))}
                      <div className="text-center text-[9.5px] font-black uppercase tracking-[0.13em] text-neutral-500">{label}</div>

                      {/* Par */}
                      <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Par</div>
                      {half.map(n => (
                        <div key={n} className="text-center font-mono text-[11.5px] font-bold tabular-nums" style={{ color: GOLD }}>
                          {parByHole[n] ?? '—'}
                        </div>
                      ))}
                      <div className="text-center font-mono text-[11.5px] font-bold tabular-nums" style={{ color: GOLD }}>
                        {halfPar || '—'}
                      </div>

                      {/* Stroke index — straight off the course_holes rows already loaded */}
                      {hasStrokeIndex && (
                        <>
                          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">SI</div>
                          {half.map(n => (
                            <div key={n} className="text-center font-mono text-[10.5px] tabular-nums text-neutral-600">
                              {siByHole[n] ?? '·'}
                            </div>
                          ))}
                          <div />
                        </>
                      )}

                      {/* Gross */}
                      <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Gross</div>
                      {half.map(n => {
                        const sv = scored.find(s => s.hole_number === n);
                        const cat = sv ? scoreVsPar(sv.gross_score, parByHole[n] ?? 0) : null;
                        const color = cat ? SCORE_COLORS[cat] : null;
                        return (
                          <div
                            key={n}
                            className="mx-auto flex h-7 w-7 items-center justify-center rounded-md font-mono text-[12px] font-bold tabular-nums"
                            style={color ? { color, backgroundColor: color === PLAIN ? 'transparent' : `${color}25` } : { color: '#333' }}
                          >
                            {sv?.gross_score ?? '·'}
                          </div>
                        );
                      })}
                      <div className="text-center font-mono text-sm font-bold tabular-nums text-white">{halfGross || '·'}</div>

                      {/* Points */}
                      {isStableford && (
                        <>
                          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Pts</div>
                          {half.map(n => {
                            const sv = scored.find(s => s.hole_number === n);
                            return (
                              <div
                                key={n}
                                className="text-center font-mono text-[11.5px] font-bold tabular-nums"
                                style={{ color: sv ? ptsColor(sv.stableford_pts ?? 0) : '#333' }}
                              >
                                {sv?.stableford_pts ?? '·'}
                              </div>
                            );
                          })}
                          <div className="text-center font-mono text-sm font-bold tabular-nums" style={{ color: GOLD }}>
                            {halfPts || '·'}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Colour key — the same classification the cells above use */}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#1c1c1c] pt-4">
                {[
                  { label: 'Eagle+', color: GOLD },
                  { label: 'Birdie', color: RED },
                  { label: 'Par',    color: PLAIN },
                  { label: 'Bogey',  color: BLUE },
                  { label: 'Dbl+',   color: DARKBLUE },
                ].map(k => (
                  <span key={k.label} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: k.color }} />
                    {k.label}
                  </span>
                ))}
              </div>
            </div>
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
