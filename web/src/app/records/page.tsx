import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Trophy, Flag, Bird, Zap, Lock } from 'lucide-react';

interface Champion {
  year: number | null;
  award_name: string | null;
  winner_name: string | null;
  winner_type: string | null;
  detail: string | null;
}

interface LiveRecord {
  label: string;
  icon: ReactNode;
  value: string;
  holder: string | null;
  color: string;
}

export default async function RecordsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Optional auth — resolve the signed-in player's society, if any.
  let societyId: string | null = null;
  if (user) {
    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (player) {
      const { data: member } = await supabase
        .from('society_members').select('society_id')
        .eq('player_id', player.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      societyId = member?.society_id ?? null;
    }
  }

  // Not signed in (or no society) → prompt.
  if (!user || !societyId) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-12">
        <RecordsHeader societyName={null} />
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 flex justify-center"><Lock size={36} className="text-slate-600" /></div>
          <h3 className="text-lg font-bold text-white">Sign in to see your society&apos;s records</h3>
          <p className="mt-1 text-sm text-slate-400">
            The Wall of Records shows champions and all-time bests for your golf society.
          </p>
          {!user && (
            <Link
              href="/auth/login"
              className="mt-5 inline-block rounded-lg bg-[#D4AF37] px-5 py-2.5 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    );
  }

  const [{ data: society }, { data: champions }, { data: comps }] = await Promise.all([
    supabase.from('societies').select('name').eq('id', societyId).single(),
    supabase.from('champions').select('year, award_name, winner_name, winner_type, detail').eq('society_id', societyId).order('year', { ascending: false }),
    supabase.from('competitions').select('id').eq('society_id', societyId),
  ]);

  // Live records — computed from raw hole data scoped to this society.
  const compIds = (comps ?? []).map((c: any) => c.id);
  const { data: matches } = compIds.length
    ? await supabase.from('matches').select('id').in('competition_id', compIds)
    : { data: null };
  const matchIds = (matches ?? []).map((m: any) => m.id);

  const [{ data: holes }, { data: players }] = matchIds.length
    ? await Promise.all([
        supabase.from('match_holes').select('match_id, player_id, gross_score, stableford_pts').in('match_id', matchIds),
        supabase.from('players').select('id, display_name'),
      ])
    : [{ data: null }, { data: null }];

  const nameOf = (pid: string) =>
    (players ?? []).find((p: any) => p.id === pid)?.display_name ?? 'Unknown';

  // Aggregate per (match, player) round.
  const roundAgg: Record<string, { pid: string; gross: number; grossHoles: number; stableford: number; birdies: number; eagles: number }> = {};
  (holes ?? []).forEach((h: any) => {
    const key = `${h.match_id}:${h.player_id}`;
    if (!roundAgg[key]) roundAgg[key] = { pid: h.player_id, gross: 0, grossHoles: 0, stableford: 0, birdies: 0, eagles: 0 };
    const r = roundAgg[key];
    if (h.gross_score != null) { r.gross += h.gross_score; r.grossHoles += 1; }
    if (h.stableford_pts != null) {
      r.stableford += h.stableford_pts;
      if (h.stableford_pts === 3) r.birdies += 1;
      if (h.stableford_pts >= 4) r.eagles += 1;
    }
  });
  const allRounds = Object.values(roundAgg);

  let bestStableford: { value: number; pid: string } | null = null;
  let bestGross: { value: number; pid: string } | null = null;
  let mostBirdies: { value: number; pid: string } | null = null;
  let mostEagles: { value: number; pid: string } | null = null;

  allRounds.forEach(r => {
    if (r.stableford > 0 && (!bestStableford || r.stableford > bestStableford.value)) {
      bestStableford = { value: r.stableford, pid: r.pid };
    }
    if (r.grossHoles >= 18 && (!bestGross || r.gross < bestGross.value)) {
      bestGross = { value: r.gross, pid: r.pid };
    }
    if (r.birdies > 0 && (!mostBirdies || r.birdies > mostBirdies.value)) {
      mostBirdies = { value: r.birdies, pid: r.pid };
    }
    if (r.eagles > 0 && (!mostEagles || r.eagles > mostEagles.value)) {
      mostEagles = { value: r.eagles, pid: r.pid };
    }
  });

  const liveRecords: LiveRecord[] = [
    {
      label: 'Best Stableford', icon: <Trophy size={22} />, color: '#D4AF37',
      value: bestStableford ? `${(bestStableford as { value: number }).value} pts` : '—',
      holder: bestStableford ? nameOf((bestStableford as { pid: string }).pid) : null,
    },
    {
      label: 'Best Gross', icon: <Flag size={22} />, color: '#4ade80',
      value: bestGross ? `${(bestGross as { value: number }).value}` : '—',
      holder: bestGross ? nameOf((bestGross as { pid: string }).pid) : null,
    },
    {
      label: 'Most Birdies', icon: <Bird size={22} />, color: '#3b82f6',
      value: mostBirdies ? `${(mostBirdies as { value: number }).value}` : '—',
      holder: mostBirdies ? nameOf((mostBirdies as { pid: string }).pid) : null,
    },
    {
      label: 'Most Eagles', icon: <Zap size={22} />, color: '#a78bfa',
      value: mostEagles ? `${(mostEagles as { value: number }).value}` : '—',
      holder: mostEagles ? nameOf((mostEagles as { pid: string }).pid) : null,
    },
  ];

  // Group champions by year.
  const championList = (champions ?? []) as Champion[];
  const byYear: Record<string, Champion[]> = {};
  championList.forEach(c => {
    const y = c.year != null ? String(c.year) : 'Other';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(c);
  });
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  const hasLiveRecords = liveRecords.some(r => r.holder != null);
  const hasAnything = championList.length > 0 || hasLiveRecords;

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">
      <RecordsHeader societyName={(society as any)?.name ?? null} />

      {!hasAnything ? (
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-12 text-center">
          <div className="mb-3 flex justify-center"><Trophy size={36} className="text-[#D4AF37]/40" /></div>
          <h3 className="text-lg font-bold text-white">No records yet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Champions and all-time bests will appear here as rounds are played.
          </p>
        </div>
      ) : (
        <div className="space-y-12">

          {/* ── Live records ─────────────────────────────────── */}
          {hasLiveRecords && (
            <section>
              <h2 className="mb-4 text-lg font-black text-white">All-Time Bests</h2>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {liveRecords.map(r => (
                  <div
                    key={r.label}
                    className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 text-center"
                    style={{ borderColor: r.holder ? `${r.color}44` : undefined }}
                  >
                    <div className="mb-2 flex justify-center" style={{ color: r.color }}>{r.icon}</div>
                    <div className="text-3xl font-black" style={{ color: r.color }}>{r.value}</div>
                    <div className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-500">{r.label}</div>
                    <div className="mt-2 text-sm font-semibold text-white">{r.holder ?? '—'}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Champions wall ───────────────────────────────── */}
          {championList.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-black text-white">Champions</h2>
              <div className="space-y-8">
                {years.map(year => (
                  <div key={year}>
                    <div className="mb-3 flex items-center gap-3">
                      <span className="text-2xl font-black text-[#D4AF37]">{year}</span>
                      <span className="h-px flex-1 bg-[#1e2d3d]" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {byYear[year].map((c, i) => (
                        <div
                          key={`${year}-${i}`}
                          className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30"
                        >
                          <div className="mb-3 flex"><Trophy size={24} className="text-[#D4AF37]/60" /></div>
                          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
                            {c.award_name ?? 'Award'}
                          </div>
                          <div className="mt-1 text-xl font-black text-white">{c.winner_name ?? '—'}</div>
                          {c.detail && <div className="mt-2 text-sm text-slate-400">{c.detail}</div>}
                          {c.winner_type && (
                            <div className="mt-2 text-xs font-semibold uppercase tracking-widest text-slate-600">
                              {c.winner_type}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}

function RecordsHeader({ societyName }: { societyName: string | null }) {
  return (
    <div className="mb-10">
      <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
        {societyName ?? 'Titan Golf'}
      </div>
      <h1 className="mt-1 flex items-center gap-3 text-5xl font-black text-white">
        <Trophy size={16} className="text-[#D4AF37]" />
        <span>Wall of Records</span>
      </h1>
      <p className="mt-2 text-slate-400">Champions and all-time bests.</p>
    </div>
  );
}
