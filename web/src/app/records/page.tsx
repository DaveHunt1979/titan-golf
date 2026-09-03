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
      <PageShell>
        <RecordsHeader societyName={null} />
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#1c1c1c] bg-[#0a0a0a] text-neutral-600">
            <Lock size={26} />
          </div>
          <h3 className="text-lg font-black text-white">Sign in to see your society&apos;s records</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
            The Wall of Records shows champions and all-time bests for your golf society.
          </p>
          {!user && (
            <Link
              href="/auth/login"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
            >
              Sign in
            </Link>
          )}
        </div>
      </PageShell>
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
    <PageShell>
      <RecordsHeader
        societyName={(society as any)?.name ?? null}
        championCount={championList.length}
        recordCount={liveRecords.filter(r => r.holder != null).length}
      />

      {!hasAnything ? (
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[#D4AF37] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
            <Trophy size={28} />
          </div>
          <h3 className="text-lg font-black text-white">No records yet</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
            Champions and all-time bests will appear here as rounds are played.
          </p>
        </div>
      ) : (
        <div className="space-y-11">

          {/* ── Live records ─────────────────────────────────── */}
          {hasLiveRecords && (
            <section>
              <SectionHeading label="All-Time Bests" hint="Single round" />
              {/* Hairline grid — one cell per record, accent colour carried by the value. */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] lg:grid-cols-4">
                {liveRecords.map(r => {
                  const held = r.holder != null;
                  return (
                    <div
                      key={r.label}
                      className="group relative bg-[#111111] px-5 py-6 text-center transition-colors hover:bg-[#161616]"
                    >
                      {held && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 top-0 h-px"
                          style={{ backgroundColor: r.color }}
                        />
                      )}
                      <div
                        className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl border"
                        style={{
                          color: held ? r.color : '#3f3f46',
                          borderColor: held ? `${r.color}33` : '#1c1c1c',
                          backgroundColor: held ? `${r.color}12` : '#0a0a0a',
                        }}
                      >
                        {r.icon}
                      </div>
                      <div
                        className="font-mono text-[34px] font-bold leading-none tabular-nums"
                        style={{ color: held ? r.color : '#52525b' }}
                      >
                        {r.value}
                      </div>
                      <div className="mt-2.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{r.label}</div>
                      <div className="mt-2.5 text-[15px] font-black text-white">{r.holder ?? '—'}</div>
                      {held && (
                        <div className="mt-2 inline-flex rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-neutral-600">
                          Record Holder
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Champions wall ───────────────────────────────── */}
          {championList.length > 0 && (
            <section>
              <SectionHeading label="Champions" hint={`${championList.length} honour${championList.length === 1 ? '' : 's'}`} />
              <div className="space-y-8">
                {years.map(year => (
                  <div key={year}>
                    <div className="mb-3 flex items-center gap-3">
                      <span className="font-mono text-[26px] font-bold leading-none tabular-nums text-[var(--gold-bright)]">{year}</span>
                      <span className="h-px flex-1 bg-[#1c1c1c]" />
                      <span className="text-[11px] font-semibold text-neutral-600">
                        {byYear[year].length} award{byYear[year].length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {byYear[year].map((c, i) => (
                        <div
                          key={`${year}-${i}`}
                          className="group relative overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6 transition-colors hover:border-[#D4AF37]/45 hover:bg-[#D4AF37]/5"
                        >
                          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/8 text-[#D4AF37]/70 transition-colors group-hover:border-[#D4AF37]/45 group-hover:text-[var(--gold-bright)]">
                            <Trophy size={22} />
                          </div>
                          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-[#D4AF37]">
                            {c.award_name ?? 'Award'}
                          </div>
                          <div className="mt-1.5 text-[22px] font-black leading-tight text-white transition-colors group-hover:text-[var(--gold-bright)]">
                            {c.winner_name ?? '—'}
                          </div>
                          {c.detail && <div className="mt-2 text-sm text-neutral-400">{c.detail}</div>}
                          {c.winner_type && (
                            <div className="mt-3 inline-flex rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-neutral-500">
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
    </PageShell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────
// Ambient gold wash behind the header, same top-of-page treatment as the Locker Room.
function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />
      <div className="relative mx-auto max-w-screen-xl px-6 py-12">{children}</div>
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

function RecordsHeader({
  societyName,
  championCount,
  recordCount,
}: {
  societyName: string | null;
  championCount?: number;
  recordCount?: number;
}) {
  const chips = [
    championCount ? `${championCount} champion${championCount === 1 ? '' : 's'}` : null,
    recordCount ? `${recordCount} all-time best${recordCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mb-9 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
      <div className="flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:text-left">
        <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[#D4AF37] shadow-[0_0_0_5px_rgba(212,175,55,0.06),0_0_38px_-6px_rgba(212,175,55,0.55)]">
          <Trophy size={32} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">
            {societyName ?? 'Titan Golf'}
          </div>
          <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">Wall of Records</h1>
          <p className="mt-3 text-sm text-neutral-400">Champions and all-time bests.</p>
          {chips.length > 0 && (
            <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {chips.map(chip => (
                <span
                  key={chip}
                  className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
