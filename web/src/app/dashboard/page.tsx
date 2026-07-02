import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

interface Round {
  id: string;
  course_name: string | null;
  day_number: number | null;
  status: string;
  gross_total: number;
  stableford_total: number;
  holes_played: number;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players')
    .select('id,display_name,handicap_index')
    .eq('auth_uid', user.id)
    .maybeSingle();

  // Recent rounds — matches where this player appears in home_player_ids
  const { data: recentMatches } = player ? await supabase
    .from('matches')
    .select('id,status,day:day_id(course_name,day_number)')
    .contains('home_player_ids', [player.id])
    .order('created_at', { ascending: false })
    .limit(8) : { data: null };

  // Hole scores for those matches to get totals
  const matchIds = (recentMatches ?? []).map((m: any) => m.id);
  const { data: holeData } = matchIds.length && player
    ? await supabase
        .from('match_holes')
        .select('match_id,gross_score,stableford_pts')
        .in('match_id', matchIds)
        .eq('player_id', player.id)
    : { data: null };

  // Build round summaries
  const rounds: Round[] = (recentMatches ?? []).map((m: any) => {
    const mh = (holeData ?? []).filter((h: any) => h.match_id === m.id);
    return {
      id: m.id,
      course_name: m.day?.course_name ?? null,
      day_number: m.day?.day_number ?? null,
      status: m.status,
      gross_total: mh.reduce((s: number, h: any) => s + (h.gross_score ?? 0), 0),
      stableford_total: mh.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0),
      holes_played: mh.filter((h: any) => h.gross_score != null).length,
    };
  }).filter((r: Round) => r.holes_played > 0);

  const completedRounds = rounds.filter(r => r.status === 'complete');
  const avgStableford = completedRounds.length
    ? Math.round(completedRounds.reduce((s, r) => s + r.stableford_total, 0) / completedRounds.length)
    : null;
  const bestStableford = completedRounds.length
    ? Math.max(...completedRounds.map(r => r.stableford_total))
    : null;

  const firstName = (player?.display_name ?? user.email ?? 'Golfer').split(' ')[0];

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="mb-10 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Welcome back</div>
          <h1 className="mt-1 text-5xl font-black text-white">{firstName}</h1>
        </div>
        {player?.handicap_index != null && (
          <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-6 py-4 text-center">
            <div className="text-3xl font-black text-[#D4AF37]">{player.handicap_index.toFixed(1)}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">Handicap Index</div>
          </div>
        )}
      </div>

      {/* ── Quick stats ──────────────────────────────────────── */}
      {completedRounds.length > 0 && (
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: 'Rounds played', value: completedRounds.length },
            { label: 'Best Stableford', value: bestStableford !== null ? `${bestStableford} pts` : '—' },
            { label: 'Avg Stableford', value: avgStableford !== null ? `${avgStableford} pts` : '—' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[#1e2d3d] bg-[#0f1923] p-5 text-center">
              <div className="text-2xl font-black text-white">{s.value}</div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Nav cards ────────────────────────────────────────── */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: '🏆', label: 'Leaderboard', href: '/leaderboard', desc: 'Live Kronos Trophy & team standings' },
          { icon: '📊', label: 'My Stats', href: '/stats', desc: 'Club distances, drives, handicap trend' },
          { icon: '🏌️', label: 'Round History', href: '/rounds', desc: 'Every round with full scorecard' },
          { icon: '🎖️', label: 'Wall of Records', href: '/records', desc: 'Society records — who holds what' },
        ].map(item => (
          <Link
            key={item.label}
            href={item.href}
            className="group rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30 hover:bg-[#121e2b]"
          >
            <div className="mb-3 text-3xl">{item.icon}</div>
            <div className="font-bold text-white transition-colors group-hover:text-[#D4AF37]">{item.label}</div>
            <div className="mt-1 text-sm text-slate-500">{item.desc}</div>
          </Link>
        ))}
      </div>

      {/* ── Recent rounds ────────────────────────────────────── */}
      {rounds.length > 0 && (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-white">Recent Rounds</h2>
            <Link href="/rounds" className="text-xs font-semibold text-[#D4AF37] hover:underline">View all →</Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
            {/* Header */}
            <div className="grid grid-cols-[1fr_5rem_5rem_5rem_6rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
              {['Course', 'Holes', 'Gross', 'Pts', 'Status'].map(h => (
                <div key={h} className={`text-xs font-bold uppercase tracking-widest text-slate-500 ${h !== 'Course' ? 'text-center' : ''}`}>{h}</div>
              ))}
            </div>
            {rounds.slice(0, 6).map((r, i) => (
              <div key={r.id}
                className={`grid grid-cols-[1fr_5rem_5rem_5rem_6rem] gap-4 items-center border-b border-[#1e2d3d] px-5 py-4 last:border-0 transition-colors hover:bg-white/3 ${i % 2 === 0 ? 'bg-[#070b10]' : 'bg-[#0a0f17]'}`}
              >
                <div>
                  <div className="text-sm font-semibold text-white">{r.course_name ?? 'Unknown course'}</div>
                  {r.day_number && <div className="text-xs text-slate-500">Day {r.day_number}</div>}
                </div>
                <div className="text-center text-sm text-slate-400">{r.holes_played}</div>
                <div className="text-center text-sm font-semibold text-white">{r.gross_total || '—'}</div>
                <div className="text-center text-sm font-black text-[#D4AF37]">{r.stableford_total || '—'}</div>
                <div className="text-center">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    r.status === 'complete'
                      ? 'bg-[#4ade80]/10 text-[#4ade80]'
                      : 'bg-[#D4AF37]/10 text-[#D4AF37]'
                  }`}>
                    {r.status === 'complete' ? 'Done' : 'Live'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rounds.length === 0 && (
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 text-4xl">⛳</div>
          <h3 className="text-lg font-bold text-white">No rounds yet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Open the Titan Golf app, start a round, and your stats will appear here instantly.
          </p>
        </div>
      )}

    </div>
  );
}
