import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="mb-10">
        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Your golf</div>
        <h1 className="mt-1 text-5xl font-black text-white">Round History</h1>
        <p className="mt-2 text-slate-400">Every completed round with full scorecard totals.</p>
      </div>

      {rounds.length === 0 ? (
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 text-4xl">⛳</div>
          <h3 className="text-lg font-bold text-white">No completed rounds yet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Finish a round in the Titan Golf app and it will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#1e2d3d]">
          {/* Header */}
          <div className="grid min-w-[56rem] grid-cols-[1fr_7rem_4rem_5rem_5rem_5rem_6rem_5rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Course</div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Date</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">Holes</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">Gross</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">To Par</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">Pts</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">Fairway</div>
            <div className="text-center text-xs font-bold uppercase tracking-widest text-slate-500">Putts</div>
          </div>

          {rounds.map((r, i) => {
            const isLeader = bestStableford != null && r.stablefordTotal === bestStableford;
            const fairwayPct = r.fairwaysTracked
              ? Math.round((r.fairwaysHit / r.fairwaysTracked) * 100)
              : null;
            return (
              <div
                key={r.id}
                className={`grid min-w-[56rem] grid-cols-[1fr_7rem_4rem_5rem_5rem_5rem_6rem_5rem] items-center gap-4 border-b border-[#1e2d3d] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
                  isLeader ? 'bg-[#D4AF37]/5' : i % 2 === 0 ? 'bg-[#070b10]' : 'bg-[#0a0f17]'
                }`}
              >
                <div>
                  <div className={`text-sm font-semibold ${isLeader ? 'text-[#D4AF37]' : 'text-white'}`}>
                    {r.courseName}
                  </div>
                  {r.dayNumber && <div className="text-xs text-slate-500">Day {r.dayNumber}</div>}
                </div>
                <div className="text-sm text-slate-400">{fmtDate(r.playDate)}</div>
                <div className="text-center text-sm text-slate-400">{r.holesPlayed}</div>
                <div className="text-center text-sm font-semibold text-white">{r.grossTotal || '—'}</div>
                <div className={`text-center text-sm font-bold ${
                  r.toPar == null ? 'text-slate-600' : r.toPar <= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'
                }`}>
                  {fmtToPar(r.toPar)}
                </div>
                <div className={`text-center text-sm font-black ${isLeader ? 'text-[#D4AF37]' : 'text-[#D4AF37]'}`}>
                  {r.stablefordTotal || '—'}
                </div>
                <div className="text-center text-sm text-slate-400">
                  {fairwayPct == null ? '—' : (
                    <span>
                      <span className="font-semibold text-white">{fairwayPct}%</span>
                      <span className="ml-1 text-xs text-slate-600">{r.fairwaysHit}/{r.fairwaysTracked}</span>
                    </span>
                  )}
                </div>
                <div className="text-center text-sm text-slate-400">
                  {r.avgPutts == null ? '—' : r.avgPutts.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
