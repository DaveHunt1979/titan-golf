import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BarChart2, Flag, Trophy } from 'lucide-react';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players')
    .select('id,display_name,handicap_index,home_course,bio,created_at')
    .eq('auth_uid', user.id)
    .maybeSingle();

  if (!player) redirect('/dashboard');

  const pid = (player as any).id;
  const firstName = ((player as any).display_name ?? user.email ?? 'Golfer').split(' ')[0];
  const hcp: number | null = (player as any).handicap_index ?? null;

  const [
    { data: recentMatches },
    { data: handicaps },
    { data: scoring },
    { data: societyMember },
  ] = await Promise.all([
    supabase.from('matches')
      .select('id,status,created_at,day:day_id(course_name,day_date)')
      .contains('home_player_ids', [pid])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('handicap_history')
      .select('handicap_index,calculated_at')
      .eq('player_id', pid)
      .order('calculated_at', { ascending: true })
      .limit(20),
    supabase.from('match_holes')
      .select('match_id,stableford_pts,gross_score')
      .eq('player_id', pid),
    supabase.from('society_members')
      .select('society_id,societies(name),joined_at')
      .eq('player_id', pid)
      .maybeSingle(),
  ]);

  // Match IDs for recent matches
  const matchIds = (recentMatches ?? []).map((m: any) => m.id);
  const { data: holesByMatch } = matchIds.length
    ? await supabase.from('match_holes').select('match_id,gross_score,stableford_pts').in('match_id', matchIds).eq('player_id', pid)
    : { data: [] };

  // Career stats from all scoring data
  const allHoles = (scoring ?? []) as any[];
  const totalHoles = allHoles.filter((h: any) => h.gross_score != null).length;
  const totalPts   = allHoles.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0);
  const eagles     = allHoles.filter((h: any) => (h.stableford_pts ?? 0) >= 4).length;
  const birdies    = allHoles.filter((h: any) => h.stableford_pts === 3).length;
  const pars       = allHoles.filter((h: any) => h.stableford_pts === 2).length;

  // Unique rounds played
  const roundsSet = new Set(allHoles.map((h: any) => h.match_id).filter(Boolean));
  const totalRounds = roundsSet.size;
  const avgPts = totalRounds > 0 ? Math.round(totalPts / totalRounds) : null;

  // Best round
  const ptsPerMatch: Record<string, number> = {};
  for (const h of allHoles) {
    if (h.match_id) ptsPerMatch[h.match_id] = (ptsPerMatch[h.match_id] ?? 0) + (h.stableford_pts ?? 0);
  }
  const bestPts = Object.values(ptsPerMatch).length ? Math.max(...Object.values(ptsPerMatch)) : null;

  // Recent rounds with totals
  const recentWithTotals = (recentMatches ?? []).map((m: any) => {
    const mh = (holesByMatch ?? []).filter((h: any) => h.match_id === m.id);
    return {
      id: m.id,
      courseName: m.day?.course_name ?? 'Course',
      date: m.day?.day_date ?? m.created_at,
      status: m.status,
      pts: mh.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0),
      holes: mh.filter((h: any) => h.gross_score != null).length,
    };
  }).filter((r: any) => r.holes > 0);

  // Handicap trend
  const hcpPoints = (handicaps ?? []).filter((h: any) => h.handicap_index != null) as any[];

  const societyName = (societyMember as any)?.societies?.name ?? null;
  const joinedAt = (societyMember as any)?.joined_at ?? null;

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="mb-10 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {/* Avatar */}
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 border-[#D4AF37]/40 bg-[#D4AF37]/10 text-4xl font-black text-[#D4AF37]">
          {((player as any).display_name ?? 'G')[0].toUpperCase()}
        </div>

        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
            {societyName ?? 'Titan Golf'}
          </div>
          <h1 className="mt-1 text-5xl font-black text-white">{(player as any).display_name ?? 'Golfer'}</h1>
          {joinedAt && (
            <div className="mt-2 text-sm text-slate-500">
              Member since {new Date(joinedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </div>
          )}
        </div>

        {hcp != null && (
          <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-8 py-5 text-center">
            <div className="text-4xl font-black text-[#D4AF37]">{hcp.toFixed(1)}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Handicap Index</div>
          </div>
        )}
      </div>

      {/* ── Career stats ─────────────────────────────────────── */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Rounds Played', value: totalRounds || '—' },
          { label: 'Best Round', value: bestPts != null ? `${bestPts} pts` : '—' },
          { label: 'Avg Per Round', value: avgPts != null ? `${avgPts} pts` : '—' },
          { label: 'Holes Played', value: totalHoles || '—' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
            <div className="text-3xl font-black text-white">{s.value}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Scoring highlights ───────────────────────────────── */}
      {totalHoles > 0 && (
        <div className="mb-8">
          <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Scoring Highlights</div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Eagles+', value: eagles, color: '#D4AF37' },
              { label: 'Birdies', value: birdies, color: '#4ade80' },
              { label: 'Pars', value: pars, color: '#e2e8f0' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
                <div className="text-3xl font-black" style={{ color: s.color }}>{s.value}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Handicap trend ───────────────────────────────────── */}
      {hcpPoints.length > 1 && (
        <div className="mb-8">
          <div className="mb-4 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Handicap Trend</div>
          <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6">
            {(() => {
              const vals = hcpPoints.map((h: any) => h.handicap_index as number);
              const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
              const W = 400, H = 80, PAD = 12;
              const coords = hcpPoints.map((h: any, i: number) => ({
                x: hcpPoints.length === 1 ? W / 2 : PAD + (i / (hcpPoints.length - 1)) * (W - PAD * 2),
                y: PAD + (1 - (h.handicap_index - min) / range) * (H - PAD * 2),
                v: h.handicap_index as number,
              }));
              const first = vals[0], last = vals[vals.length - 1];
              const change = last - first;
              return (
                <>
                  <div className="mb-5 grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-black text-white">{first.toFixed(1)}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Start</div>
                    </div>
                    <div>
                      <div className={`text-2xl font-black ${change === 0 ? 'text-slate-400' : change < 0 ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                        {change === 0 ? '—' : `${change < 0 ? '▼' : '▲'} ${Math.abs(change).toFixed(1)}`}
                      </div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Change</div>
                    </div>
                    <div>
                      <div className="text-2xl font-black text-[#D4AF37]">{last.toFixed(1)}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">Current</div>
                    </div>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 80 }}>
                    {coords.slice(1).map((c, i) => {
                      const prev = coords[i];
                      const stroke = c.v === prev.v ? '#64748b' : c.v < prev.v ? '#4ade80' : '#f87171';
                      return <line key={i} x1={prev.x} y1={prev.y} x2={c.x} y2={c.y} stroke={stroke} strokeWidth={2} strokeLinecap="round" />;
                    })}
                    {coords.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={2.5} fill="#D4AF37" />)}
                  </svg>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Recent rounds ────────────────────────────────────── */}
      {recentWithTotals.length > 0 && (
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Recent Rounds</div>
            <Link href="/rounds" className="text-xs font-semibold text-[#D4AF37] hover:underline">View all →</Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
            <div className="grid grid-cols-[1fr_5rem_5rem_6rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
              {['Course', 'Holes', 'Pts', 'Status'].map(h => (
                <div key={h} className={`text-xs font-bold uppercase tracking-widest text-slate-500 ${h !== 'Course' ? 'text-center' : ''}`}>{h}</div>
              ))}
            </div>
            {recentWithTotals.slice(0, 6).map((r: any, i: number) => (
              <div key={r.id}
                className={`grid grid-cols-[1fr_5rem_5rem_6rem] gap-4 items-center border-b border-[#1e2d3d] px-5 py-4 last:border-0 transition-colors hover:bg-white/3 ${i % 2 === 0 ? 'bg-[#070b10]' : 'bg-[#0a0f17]'}`}
              >
                <div>
                  <div className="text-sm font-semibold text-white">{r.courseName}</div>
                  {r.date && (
                    <div className="text-xs text-slate-500">
                      {new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
                <div className="text-center text-sm text-slate-400">{r.holes}</div>
                <div className="text-center text-sm font-black text-[#D4AF37]">{r.pts || '—'}</div>
                <div className="text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.status === 'complete' ? 'bg-[#4ade80]/10 text-[#4ade80]' : 'bg-[#D4AF37]/10 text-[#D4AF37]'}`}>
                    {r.status === 'complete' ? 'Done' : 'Live'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick links ──────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {([
          { icon: <BarChart2 size={22} />, label: 'Full Stats', href: '/stats', desc: 'Club distances, putting & more' },
          { icon: <Flag size={22} />, label: 'Round History', href: '/rounds', desc: 'Every round with full scorecard' },
          { icon: <Trophy size={22} />, label: 'Leaderboard', href: '/leaderboard', desc: 'Season standings & records' },
        ] as const).map(item => (
          <Link key={item.label} href={item.href}
            className="group rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30 hover:bg-[#121e2b]"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/8 text-[#D4AF37] transition-colors group-hover:border-[#D4AF37]/40 group-hover:bg-[#D4AF37]/12">
              {item.icon}
            </div>
            <div className="font-bold text-white transition-colors group-hover:text-[#D4AF37]">{item.label}</div>
            <div className="mt-1 text-sm text-slate-500">{item.desc}</div>
          </Link>
        ))}
      </div>

    </div>
  );
}
