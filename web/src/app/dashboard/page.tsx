import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { User, Trophy, History, Award, ShieldCheck, ArrowUpRight } from 'lucide-react';

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

  // Society role → is this player an admin/owner? Same check /admin itself runs
  // (first membership by created_at, role in admin|owner), used only to decide
  // whether the Tournament Control card renders.
  const { data: roleRow } = player
    ? await supabase
        .from('society_members').select('role')
        .eq('player_id', player.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const isAdmin = ['admin', 'owner'].includes((roleRow as any)?.role ?? '');

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
  const initial = (firstName[0] ?? 'G').toUpperCase();
  const hcpDisplay = player?.handicap_index != null ? Number(player.handicap_index).toFixed(1) : null;
  const liveCount = friendStatuses.filter(f => f.matchId).length;

  // Hero meta chips — same facts the page already had, just surfaced as chips.
  const metaChips = [
    completedRounds.length > 0
      ? `${completedRounds.length} round${completedRounds.length === 1 ? '' : 's'} logged`
      : 'No rounds logged yet',
    hcpDisplay ? `Handicap Index ${hcpDisplay}` : null,
    isAdmin ? 'Society Admin' : null,
  ].filter(Boolean) as string[];

  // Quick stats — unchanged numbers, restyled as hairline stat tiles.
  const statTiles: { label: string; value: string | number; suffix?: string; gold?: boolean }[] = [
    { label: 'Handicap Index',  value: hcpDisplay ?? '—', gold: true },
    { label: 'Rounds Played',   value: completedRounds.length },
    { label: 'Best Stableford', value: bestStableford !== null ? bestStableford : '—', suffix: bestStableford !== null ? 'pts' : undefined, gold: true },
    { label: 'Avg Stableford',  value: avgStableford  !== null ? avgStableford  : '—', suffix: avgStableford  !== null ? 'pts' : undefined },
  ];

  const navCards: { icon: ReactNode; label: string; href: string; desc: string; admin?: boolean }[] = [
    { icon: <User size={22} />,    label: 'My Profile',      href: '/profile',     desc: 'Stats, handicap trend & recent form' },
    { icon: <Trophy size={22} />,  label: 'Leaderboard',     href: '/leaderboard', desc: 'Live Kronos Trophy & team standings' },
    { icon: <History size={22} />, label: 'Round History',   href: '/rounds',      desc: 'Every round with full scorecard' },
    { icon: <Award size={22} />,   label: 'Wall of Records', href: '/records',     desc: 'Society records — who holds what' },
  ];
  if (isAdmin) {
    navCards.push({
      icon: <ShieldCheck size={22} />,
      label: 'Tournament Control',
      href: '/admin',
      desc: 'Admin panel — tee sheet, comps, codes & PINs',
      admin: true,
    });
  }

  return (
    <div className="relative">
      {/* Ambient gold wash behind the hero — same top-of-page treatment as the Locker Room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:text-left">

            {/* Avatar — gold ring + green halo, handicap badge overlapping the ring */}
            <div className="relative shrink-0">
              <div className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[38px] font-black leading-none text-[var(--gold-bright)] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
                {initial}
              </div>
              {hcpDisplay && (
                <span
                  title="Handicap Index"
                  className="absolute -right-2.5 -top-1.5 rounded-full border-2 border-[#111111] bg-[#4ade80] px-2.5 py-0.5 font-mono text-[12px] font-bold tabular-nums text-[#052012]"
                >
                  {hcpDisplay}
                </span>
              )}
            </div>

            {/* Identity */}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Welcome back</div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">{firstName}</h1>
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
              <Link
                href="/profile"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
              >
                <User size={13} />
                My Player Card
              </Link>
            </div>

            {/* Live-now marker — derived from the friends data already loaded */}
            {liveCount > 0 && (
              <div className="shrink-0 rounded-xl border border-[#4ade80]/25 bg-[#4ade80]/5 px-4 py-3 text-center sm:self-start">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#4ade80]">Live Now</span>
                </div>
                <div className="mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums text-white">{liveCount}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">
                  {liveCount === 1 ? 'member out' : 'members out'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Quick stats ──────────────────────────────────────── */}
        {completedRounds.length > 0 && (
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
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

        {/* ── Nav cards ────────────────────────────────────────── */}
        <SectionHeading label="Clubhouse" />
        <div className={`mb-8 grid gap-4 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
          {navCards.map(item => (
            <Link
              key={item.label}
              href={item.href}
              className={`group relative rounded-2xl border p-6 transition-colors ${
                item.admin
                  ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5 hover:border-[#D4AF37]/60 hover:bg-[#D4AF37]/8'
                  : 'border-[#1c1c1c] bg-[#111111] hover:border-neutral-700 hover:bg-[#1a1a1a]'
              }`}
            >
              <ArrowUpRight
                size={15}
                className="absolute right-4 top-4 text-neutral-700 transition-colors group-hover:text-[var(--gold-bright)]"
              />
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/8 text-neutral-500 transition-colors group-hover:border-[#D4AF37]/40 group-hover:bg-[#D4AF37]/12 group-hover:text-[var(--gold-bright)]">
                {item.icon}
              </div>
              <div className="font-bold text-white transition-colors group-hover:text-[var(--gold-bright)]">{item.label}</div>
              <div className="mt-1 text-sm text-neutral-500">{item.desc}</div>
              {item.admin && (
                <div className="mt-3 inline-flex rounded-full bg-[#D4AF37]/10 px-2 py-0.5 text-[9.5px] font-black uppercase tracking-widest text-[#D4AF37]">
                  Admin Only
                </div>
              )}
            </Link>
          ))}
        </div>

        {/* ── Friends on a Round ───────────────────────────────── */}
        {friendStatuses.length > 0 && (
          <div className="mb-8">
            <SectionHeading label="Members" hint={`${liveCount} on a round`} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {friendStatuses.map(f => (
                <div
                  key={f.playerId}
                  className={`rounded-2xl border p-4 transition-colors ${
                    f.matchId
                      ? 'border-[#D4AF37]/30 bg-[#D4AF37]/5 hover:border-[#D4AF37]/55 hover:bg-[#D4AF37]/8'
                      : 'border-[#1c1c1c] bg-[#0a0a0a] hover:border-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-black ${
                        f.matchId
                          ? 'border-[#D4AF37] bg-[#1a1a1a] text-[var(--gold-bright)] shadow-[0_0_0_3px_rgba(74,222,128,0.10)]'
                          : 'border-[#1c1c1c] bg-[#111111] text-neutral-500'
                      }`}
                    >
                      {f.name[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-white">{f.name.split(' ')[0]}</div>
                      {f.matchId ? (
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#4ade80]" />
                          <span className="truncate text-xs text-[#D4AF37]">{f.courseName} · Hole {f.hole}</span>
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs text-neutral-600">Not on a round</div>
                      )}
                    </div>
                    {f.matchId && f.pts != null && (
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-xl font-bold tabular-nums leading-none text-[var(--gold-bright)]">{f.pts}</div>
                        <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600">pts</div>
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
            <div className="mb-3 flex items-center gap-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Recent Rounds</h2>
              <span className="h-px flex-1 bg-[#1c1c1c]" />
              <Link href="/rounds" className="text-[11px] font-bold text-neutral-500 transition-colors hover:text-[var(--gold-bright)]">
                View all →
              </Link>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
              {/* Header */}
              <div className="grid grid-cols-[1fr_5rem_5rem_5rem_6rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                {['Course', 'Holes', 'Gross', 'Pts', 'Status'].map(h => (
                  <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Course' ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              {rounds.slice(0, 6).map((r, i) => {
                // Same status vocabulary as the admin tee-sheet board.
                const chip = r.status === 'complete'
                  ? { label: 'Complete', cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]' }
                  : { label: 'Live',     cls: 'bg-[#4ade80]/10 text-[#4ade80]' };
                return (
                  <div key={r.id}
                    className={`grid grid-cols-[1fr_5rem_5rem_5rem_6rem] gap-4 items-center border-b border-[#1c1c1c] px-5 py-4 last:border-0 transition-colors hover:bg-white/3 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{r.course_name ?? 'Unknown course'}</div>
                      {r.day_number && <div className="text-xs text-neutral-500">Day {r.day_number}</div>}
                    </div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{r.holes_played}</div>
                    <div className="text-center font-mono text-sm font-bold tabular-nums text-white">{r.gross_total || '—'}</div>
                    <div className="text-center font-mono text-sm font-bold tabular-nums text-[var(--gold-bright)]">{r.stableford_total || '—'}</div>
                    <div className="text-center">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${chip.cls}`}>
                        {chip.label === 'Live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />}
                        {chip.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {rounds.length === 0 && (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-3xl shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              ⛳
            </div>
            <h3 className="text-lg font-black text-white">No rounds yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
              Open the Titan Golf app, start a round, and your stats will appear here instantly.
            </p>
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
