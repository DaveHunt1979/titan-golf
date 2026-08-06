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
  for (const c of (courseHoles ?? []) as any[]) parByHole[c.hole_number] = c.par;

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

  return (
    <div className="mx-auto max-w-screen-md px-6 py-12">
      <Link href="/rounds" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-neutral-400 transition-colors hover:text-[#D4AF37]">
        <ArrowLeft size={16} /> Round History
      </Link>

      {/* ── Trophy card ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-8 text-center">
        <Trophy size={48} className="mx-auto mb-3" style={{ color: GOLD }} />
        <div className="text-xs font-bold uppercase tracking-widest text-neutral-400">{courseName}</div>
        <div className="mt-1 text-xs text-neutral-500">{fmtDate(m.day?.play_date)}{holesToPlay < 18 ? ` · ${holesToPlay} holes` : ''}</div>
        <div className="mt-4 text-5xl font-black" style={{ color: scoreColor }}>{finalScore}</div>
        <div className="mt-1 text-sm font-semibold text-neutral-400">
          {isStableford ? `${grossTotal} gross · ${ptsTotal} pts` : `${grossTotal} gross`}
        </div>

        {/* Stat grid */}
        <div className="mt-6 grid grid-cols-5 gap-2">
          {[
            { n: eagles,  label: 'Eagles',  color: GOLD },
            { n: birdies, label: 'Birdies', color: RED },
            { n: pars,    label: 'Pars',    color: PLAIN },
            { n: bogeys,  label: 'Bogeys',  color: BLUE },
            { n: doubles, label: 'Dbl+',    color: DARKBLUE },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] py-3">
              <div className="text-2xl font-black" style={{ color: s.color }}>{s.n}</div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Best / Worst */}
        {bestHole && worstHole && bestHole.hole_number !== worstHole.hole_number && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Best</div>
              <div className="mt-1 text-lg font-bold text-[#4ade80]">Hole {bestHole.hole_number}</div>
              <div className="text-xs text-neutral-400">{vsParLabel(bestHole.vsPar)}</div>
            </div>
            <div className="rounded-xl border border-[#1c1c1c] bg-[#0a0a0a] py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Worst</div>
              <div className="mt-1 text-lg font-bold text-[#f87171]">Hole {worstHole.hole_number}</div>
              <div className="text-xs text-neutral-400">{vsParLabel(worstHole.vsPar)}</div>
            </div>
          </div>
        )}

        {/* Fairways / Putts chips */}
        {(fairwaysTracked > 0 || avgPutts != null) && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {fairwaysTracked > 0 && (
              <div className="rounded-full bg-[#1c1c1c] px-3 py-1 text-xs font-semibold text-white">
                FWY {fairwaysHit}/{fairwaysTracked} ({Math.round((fairwaysHit / fairwaysTracked) * 100)}%)
              </div>
            )}
            {avgPutts != null && (
              <div className="rounded-full bg-[#1c1c1c] px-3 py-1 text-xs font-semibold text-white">
                {avgPutts.toFixed(1)} putts / hole
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Hole-by-hole scorecard ───────────────────────────── */}
      {halves.length > 0 && (
        <div className="mt-6 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
          <div className="mb-4 text-xs font-bold uppercase tracking-widest text-neutral-400">Scorecard</div>
          {halves.map((half, hi) => {
            const label = hi === 0 ? 'OUT' : 'IN';
            const halfPar = half.reduce((s, n) => s + (parByHole[n] ?? 0), 0);
            const halfScores = scored.filter(s => half.includes(s.hole_number));
            const halfGross = halfScores.reduce((s, h) => s + h.gross_score, 0);
            const halfPts = halfScores.reduce((s, h) => s + (h.stableford_pts ?? 0), 0);
            return (
              <div key={hi} className={hi === 1 ? 'mt-4 border-t border-[#1c1c1c] pt-4' : ''}>
                <div className="grid gap-1" style={{ gridTemplateColumns: `4rem repeat(${half.length}, 1fr) 3.5rem` }}>
                  <div className="text-[10px] font-bold uppercase text-neutral-500">Hole</div>
                  {half.map(n => (
                    <div key={n} className={`text-center text-xs font-bold ${scored.some(s => s.hole_number === n) ? 'text-white' : 'text-neutral-700'}`}>{n}</div>
                  ))}
                  <div className="text-center text-[10px] font-bold uppercase text-neutral-500">{label}</div>

                  <div className="text-[10px] font-bold uppercase text-neutral-500">Par</div>
                  {half.map(n => (
                    <div key={n} className="text-center text-xs font-bold" style={{ color: GOLD }}>{parByHole[n] ?? '—'}</div>
                  ))}
                  <div className="text-center text-xs font-bold" style={{ color: GOLD }}>{halfPar || '—'}</div>

                  <div className="text-[10px] font-bold uppercase text-neutral-500">Gross</div>
                  {half.map(n => {
                    const sv = scored.find(s => s.hole_number === n);
                    const cat = sv ? scoreVsPar(sv.gross_score, parByHole[n] ?? 0) : null;
                    const color = cat ? SCORE_COLORS[cat] : null;
                    return (
                      <div
                        key={n}
                        className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold"
                        style={color ? { color, backgroundColor: color === PLAIN ? 'transparent' : `${color}25` } : { color: '#333' }}
                      >
                        {sv?.gross_score ?? '·'}
                      </div>
                    );
                  })}
                  <div className="text-center text-sm font-bold text-white">{halfGross || '·'}</div>

                  {isStableford && (
                    <>
                      <div className="text-[10px] font-bold uppercase text-neutral-500">Pts</div>
                      {half.map(n => {
                        const sv = scored.find(s => s.hole_number === n);
                        return (
                          <div key={n} className="text-center text-xs font-bold" style={{ color: sv ? ptsColor(sv.stableford_pts ?? 0) : '#333' }}>
                            {sv?.stableford_pts ?? '·'}
                          </div>
                        );
                      })}
                      <div className="text-center text-xs font-bold" style={{ color: GOLD }}>{halfPts || '·'}</div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
