import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { User, Trophy, History, Award } from 'lucide-react';

interface FriendStatus {
  playerId: string;
  name: string;
  courseName: string | null;
  hole: number | null;
  pts: number | null;
  matchId: string | null;
}

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

  // Society membership → friends on a round
  const { data: memberRow } = player
    ? await supabase.from('society_members').select('society_id').eq('player_id', player.id).maybeSingle()
    : { data: null };
  const societyId = (memberRow as any)?.society_id ?? null;

  let friendStatuses: FriendStatus[] = [];
  if (societyId && player) {
    const { data: allMemberRows } = await supabase
      .from('society_members').select('player_id')
      .eq('society_id', societyId).neq('player_id', player.id);
    const memberIds: string[] = (allMemberRows ?? []).map((m: any) => m.player_id);

    if (memberIds.length > 0) {
      const { data: memberPlayers } = await supabase
        .from('players').select('id,display_name').in('id', memberIds);
      const nameMap: Record<string, string> = {};
      for (const p of (memberPlayers ?? []) as any[]) nameMap[p.id] = p.display_name;

      const { data: activeMatches } = await supabase
        .from('matches').select('id,course_name,home_player_ids,away_player_ids')
        .eq('status', 'in_progress').limit(100);

      const memberSet = new Set(memberIds);
      const relevantMatches = (activeMatches ?? []).filter((m: any) =>
        [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])].some((id: string) => memberSet.has(id))
      );

      const relevantMatchIds = relevantMatches.map((m: any) => m.id);
      const { data: holesData } = relevantMatchIds.length
        ? await supabase.from('match_holes').select('player_id,stableford_pts,hole_number,match_id').in('match_id', relevantMatchIds)
        : { data: [] };

      const stats: Record<string, { pts: number; maxHole: number; matchId: string; courseName: string }> = {};
      for (const m of relevantMatches) {
        for (const id of [...(m.home_player_ids ?? []), ...(m.away_player_ids ?? [])]) {
          if (memberSet.has(id) && !stats[id])
            stats[id] = { pts: 0, maxHole: 0, matchId: m.id, courseName: m.course_name ?? 'Course' };
        }
      }
      for (const h of (holesData ?? []) as any[]) {
        if (stats[h.player_id]) {
          stats[h.player_id].pts += h.stableford_pts ?? 0;
          if (h.hole_number > stats[h.player_id].maxHole) stats[h.player_id].maxHole = h.hole_number;
        }
      }

      friendStatuses = memberIds.map(id => ({
        playerId: id,
        name: nameMap[id] ?? 'Unknown',
        courseName: stats[id]?.courseName ?? null,
        hole: stats[id] ? Math.min(stats[id].maxHole + 1, 18) : null,
        pts: stats[id]?.pts ?? null,
        matchId: stats[id]?.matchId ?? null,
      })).sort((a, b) => (a.matchId ? -1 : b.matchId ? 1 : a.name.localeCompare(b.name)));
    }
  }

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
        {([
          { icon: <User size={22} />, label: 'My Profile', href: '/profile', desc: 'Stats, handicap trend & recent form' },
          { icon: <Trophy size={22} />, label: 'Leaderboard', href: '/leaderboard', desc: 'Live Kronos Trophy & team standings' },
          { icon: <History size={22} />, label: 'Round History', href: '/rounds', desc: 'Every round with full scorecard' },
          { icon: <Award size={22} />, label: 'Wall of Records', href: '/records', desc: 'Society records — who holds what' },
        ] as const).map(item => (
          <Link
            key={item.label}
            href={item.href}
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

      {/* ── Friends on a Round ───────────────────────────────── */}
      {friendStatuses.length > 0 && (
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-black text-white">Members</h2>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              {friendStatuses.filter(f => f.matchId).length} on a round
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {friendStatuses.map(f => (
              <div
                key={f.playerId}
                className={`rounded-2xl border p-4 transition-all ${
                  f.matchId
                    ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5 hover:bg-[#D4AF37]/8'
                    : 'border-[#1e2d3d] bg-[#0a0f17]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/10 text-sm font-black text-[#D4AF37]">
                    {f.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold text-white">{f.name.split(' ')[0]}</div>
                    {f.matchId ? (
                      <div className="truncate text-xs text-[#D4AF37]">{f.courseName} · Hole {f.hole}</div>
                    ) : (
                      <div className="text-xs text-slate-600">Not on a round</div>
                    )}
                  </div>
                  {f.matchId && f.pts != null && (
                    <div className="text-right">
                      <div className="text-xl font-black text-[#D4AF37]">{f.pts}</div>
                      <div className="text-xs text-slate-500">pts</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
