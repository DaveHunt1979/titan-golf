import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Trophy, Zap, Medal, Plus } from 'lucide-react';

/** 'team_matchplay' → 'Team Matchplay' — display only, the stored value is untouched. */
function prettyFormat(format: string) {
  return String(format ?? '')
    .split('_')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

type Champion = { year: number; award_name: string; winner_name: string; winner_type: string; detail: string | null };
type Competition = { id: string; name: string; year: number | null; format: string; status: string; created_at: string; pin?: string | null };

export default async function TournamentArchivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players').select('id').eq('auth_uid', user.id).maybeSingle();

  const { data: member } = player ? await supabase
    .from('society_members').select('role, society_id')
    .eq('player_id', player.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle() : { data: null };

  const societyId = member?.society_id;
  const isAdmin   = member?.role === 'admin' || member?.role === 'owner';

  const [{ data: champions }, { data: comps }] = await Promise.all([
    societyId
      ? supabase.from('champions').select('*').eq('society_id', societyId).order('year', { ascending: false })
      : { data: [] },
    societyId
      ? supabase.from('competitions').select('id,name,year,format,status,created_at,pin').eq('society_id', societyId).order('created_at', { ascending: false })
      : { data: [] },
  ]);

  const years = [...new Set<number>((champions ?? []).map((c: any) => c.year as number))].sort((a, b) => b - a);
  const completed = (comps ?? []).filter((c: any) => c.status === 'complete');
  const active    = (comps ?? []).filter((c: any) => c.status === 'active');
  const draft     = (comps ?? []).filter((c: any) => c.status === 'draft');

  function pinDisplay(pin: string | null | undefined) {
    const clean = String(pin ?? '').replace(/[^0-9]/g, '');
    return clean.length >= 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : '—';
  }

  // Hero chips + stat tiles — re-presentation of the rows already fetched above.
  const metaChips = [
    `${(comps ?? []).length} competition${(comps ?? []).length === 1 ? '' : 's'}`,
    years.length ? `${years.length} season${years.length === 1 ? '' : 's'} of champions` : null,
    isAdmin ? 'Society Admin' : null,
  ].filter(Boolean) as string[];

  const statTiles: { label: string; value: string | number; gold?: boolean; green?: boolean }[] = [
    { label: 'Active',    value: active.length,    green: true },
    { label: 'Completed', value: completed.length },
    { label: 'Draft',     value: draft.length,     gold: true },
    { label: 'Champions', value: (champions ?? []).length, gold: true },
  ];

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
            <div className="shrink-0">
              <div className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[var(--gold-bright)] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
                <Trophy size={44} />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">Season Records</div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">Tournament History</h1>
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
              {isAdmin && (
                <a
                  href="/tournament/new"
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
                >
                  <Plus size={13} />
                  New Competition
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ── Quick stats ──────────────────────────────────────── */}
        {(comps ?? []).length > 0 && (
          <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
            {statTiles.map(s => (
              <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${
                  s.green ? 'text-[#4ade80]' : s.gold ? 'text-[var(--gold-bright)]' : 'text-white'
                }`}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Champions Wall */}
        {years.length > 0 && (
          <div className="mb-8">
            <SectionHeading label="Champions" hint={`${years.length} season${years.length === 1 ? '' : 's'}`} />
            <div className="space-y-4">
              {years.map(year => {
                const yc: Champion[] = (champions ?? []).filter((c: any) => c.year === year);
                const tour   = yc.find(c => c.award_name.toLowerCase().includes('tour') || c.award_name.toLowerCase().includes('champion'));
                const kronos = yc.find(c => c.award_name.toLowerCase().includes('kronos'));
                const others = yc.filter(c => c !== tour && c !== kronos);
                return (
                  <div key={year} className="overflow-hidden rounded-2xl border border-[#D4AF37]/25 bg-[#111111]">
                    <div className="flex items-center gap-3 border-b border-[#D4AF37]/10 bg-[#D4AF37]/5 px-6 py-3">
                      <span className="font-mono text-sm font-black tabular-nums tracking-[0.2em] text-[var(--gold-bright)]">{year}</span>
                      <span className="h-px flex-1 bg-[#D4AF37]/10" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                        {yc.length} award{yc.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="divide-y divide-[#1c1c1c]">
                      {tour && <ChampionRow champ={tour} icon={<Trophy size={18} />} gold />}
                      {kronos && <ChampionRow champ={kronos} icon={<Zap size={18} />} gold />}
                      {others.map((ch, i) => (
                        <ChampionRow key={i} champ={ch} icon={<Medal size={18} />} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Active competitions */}
        {active.length > 0 && (
          <CompSection title="Active" comps={active} isAdmin={isAdmin} pinDisplay={pinDisplay} status="active" />
        )}

        {/* Completed competitions */}
        {completed.length > 0 && (
          <CompSection title="Completed" comps={completed} isAdmin={isAdmin} pinDisplay={pinDisplay} status="complete" />
        )}

        {/* Draft competitions */}
        {draft.length > 0 && (
          <CompSection title="Draft" comps={draft} isAdmin={isAdmin} pinDisplay={pinDisplay} status="draft" />
        )}

        {years.length === 0 && (comps ?? []).length === 0 && (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              <Trophy size={28} />
            </div>
            <h3 className="text-lg font-black text-white">No tournaments yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">Create your first competition to get started.</p>
            {isAdmin && (
              <a
                href="/tournament/new"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
              >
                <Plus size={13} />
                Create Competition
              </a>
            )}
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

// ── Champion row ──────────────────────────────────────────────────────────────

function ChampionRow({ champ, icon, gold }: { champ: Champion; icon: ReactNode; gold?: boolean }) {
  return (
    <div className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/3">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
        gold
          ? 'border-[#D4AF37]/30 bg-[#D4AF37]/8 text-[var(--gold-bright)]'
          : 'border-[#1c1c1c] bg-[#0a0a0a] text-neutral-500'
      }`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{champ.award_name}</div>
        <div className={`mt-0.5 text-xl font-black ${gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{champ.winner_name}</div>
        {champ.detail && <div className="mt-0.5 text-sm text-neutral-400">{champ.detail}</div>}
      </div>
    </div>
  );
}

// ── Competition sections ──────────────────────────────────────────────────────

/**
 * Same status vocabulary as the admin tee-sheet board: live = green pulse,
 * complete = neutral bordered, draft/upcoming = gold.
 */
const COMP_STATUS: Record<'active' | 'complete' | 'draft', { badge: string; chip: string; border: string }> = {
  active:   { badge: 'LIVE',  chip: 'bg-[#4ade80]/10 text-[#4ade80]',                    border: 'border-[#4ade80]/30 hover:border-[#4ade80]/55' },
  complete: { badge: 'DONE',  chip: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]', border: 'border-[#1c1c1c] hover:border-neutral-700' },
  draft:    { badge: 'DRAFT', chip: 'bg-[#D4AF37]/10 text-[#D4AF37]',                    border: 'border-[#1c1c1c] hover:border-[#D4AF37]/40' },
};

function CompSection({ title, comps, isAdmin, pinDisplay, status }: {
  title: string; comps: Competition[]; isAdmin: boolean;
  pinDisplay: (pin: string | null | undefined) => string;
  status: 'active' | 'complete' | 'draft';
}) {
  const s = COMP_STATUS[status];
  return (
    <div className="mb-8">
      <SectionHeading label={title} hint={`${comps.length} competition${comps.length === 1 ? '' : 's'}`} />
      <div className="space-y-3">
        {comps.map(comp => (
          <div key={comp.id} className={`rounded-2xl border bg-[#111111] px-6 py-5 transition-colors ${s.border}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-black text-white">{comp.name}</h3>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${s.chip}`}>
                    {status === 'active' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ade80]" />}
                    {s.badge}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    comp.year ? String(comp.year) : null,
                    prettyFormat(comp.format),
                    new Date(comp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
                  ].filter(Boolean).map((chip, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-500"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
              {isAdmin && (
                <div className="shrink-0 rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 px-4 py-2.5 text-center">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">PIN</div>
                  <div className="mt-1 font-mono text-xl font-bold tabular-nums tracking-[4px] text-[var(--gold-bright)]">
                    {pinDisplay(comp.pin)}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
