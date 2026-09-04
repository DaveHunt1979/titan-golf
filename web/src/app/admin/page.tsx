import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Trophy, ClipboardList, Flag, BarChart3, KeyRound, ArrowUpRight, ShieldCheck, CalendarRange, Coins } from 'lucide-react';

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players').select('id, display_name').eq('auth_uid', user.id).maybeSingle();
  if (!player) redirect('/dashboard');

  const { data: member } = await supabase
    .from('society_members').select('role, society_id')
    .eq('player_id', player.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member || !['admin', 'owner'].includes(member.role ?? '')) {
    redirect('/dashboard');
  }

  const societyId = member.society_id;

  const [{ data: society }, { data: comps }, { data: players }] = await Promise.all([
    supabase.from('societies').select('name, join_pin, casual_join_code, tour_join_code, swindle_join_code').eq('id', societyId).single(),
    supabase.from('competitions').select('id, name, year, status, pin, created_at').eq('society_id', societyId).order('created_at', { ascending: false }),
    supabase.from('society_members').select('player_id, role, players(display_name, handicap_index)').eq('society_id', societyId),
  ]);

  const joinPin = String((society as any)?.join_pin ?? '').replace(/[^0-9]/g, '');
  const firstName = (player.display_name ?? 'Admin').split(' ')[0];

  function pinDisplay(pin: string | null | undefined) {
    const clean = String(pin ?? '').replace(/[^0-9]/g, '');
    return clean.length >= 6 ? `${clean.slice(0, 3)} ${clean.slice(3)}` : '—';
  }

  const compList = (comps ?? []) as any[];
  const memberList = (players ?? []) as any[];
  const liveComps = compList.filter(c => c.status === 'active').length;
  const adminCount = memberList.filter(m => ['admin', 'owner'].includes(m.role ?? '')).length;

  // Hero meta chips — facts already loaded, surfaced as chips (same as the Locker Room hero).
  const metaChips = [
    `Signed in as ${firstName}`,
    member.role === 'owner' ? 'Society Owner' : 'Society Admin',
    liveComps > 0 ? `${liveComps} competition${liveComps === 1 ? '' : 's'} live` : 'No live competition',
  ];

  const statTiles: { label: string; value: string | number; suffix?: string; gold?: boolean }[] = [
    { label: 'Competitions', value: compList.length, gold: true },
    { label: 'Live Now',     value: liveComps },
    { label: 'Members',      value: memberList.length, gold: true },
    { label: 'Admins',       value: adminCount },
  ];

  const quickActions: { icon: ReactNode; label: string; href: string; desc: string }[] = [
    { icon: <Trophy size={22} />,        label: 'New Competition',    href: '/tournament/new',     desc: 'Create a new season or casual comp' },
    { icon: <ClipboardList size={22} />, label: 'Tournament Archive', href: '/tournament/archive', desc: 'All competitions, champions & PINs' },
    { icon: <Flag size={22} />,          label: 'Tee Sheet',          href: '/admin/tee-sheet',    desc: 'Drag groups & set tee times'        },
    { icon: <Coins size={22} />,         label: 'Swindle Manager',    href: `/swindle/${societyId}/manage`, desc: 'Create & run the society swindle' },
    { icon: <CalendarRange size={22} />, label: 'Season Mode',        href: '/season',             desc: 'Divisions, majors & season standings' },
    { icon: <BarChart3 size={22} />,     label: 'Leaderboard',        href: '/leaderboard',        desc: 'Live Kronos & team standings'       },
    { icon: <KeyRound size={22} />,      label: 'Codes & PINs',       href: '/admin/codes',        desc: 'Join codes, tournament PINs & more' },
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
          <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
                <ShieldCheck size={13} />
                Admin Panel
              </div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">
                {(society as any)?.name ?? 'Society'}
              </h1>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
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

            {/* Society join PIN — the one code that stays on the main page */}
            <div className="shrink-0 rounded-xl border border-[var(--gold)]/25 bg-[var(--gold)]/5 px-5 py-4 sm:self-start">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">Society Join PIN</div>
              <div className="mt-1.5 font-mono text-[30px] font-black leading-none tracking-[5px] tabular-nums text-[var(--gold-bright)]">
                {joinPin ? `${joinPin.slice(0, 3)} ${joinPin.slice(3)}` : '—'}
              </div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-[10px] font-semibold text-neutral-600">Entered in-app to join</span>
                <a
                  href="/admin/codes"
                  className="text-[11px] font-bold text-[var(--gold)] transition-colors hover:text-[var(--gold-bright)]"
                >
                  All codes →
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick stats ──────────────────────────────────────── */}
        <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
          {statTiles.map(s => (
            <div key={s.label} className="bg-[#111111] px-4 py-3.5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
              <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Quick actions ────────────────────────────────────── */}
        <SectionHeading label="Command Deck" />
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map(item => (
            <a
              key={item.label}
              href={item.href}
              className="group relative rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6 transition-colors hover:border-neutral-700 hover:bg-[#1a1a1a]"
            >
              <ArrowUpRight
                size={15}
                className="absolute right-4 top-4 text-neutral-700 transition-colors group-hover:text-[var(--gold-bright)]"
              />
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--gold)]/20 bg-[var(--gold)]/8 text-neutral-500 transition-colors group-hover:border-[var(--gold)]/40 group-hover:bg-[var(--gold)]/12 group-hover:text-[var(--gold-bright)]">
                {item.icon}
              </div>
              <div className="font-bold text-white transition-colors group-hover:text-[var(--gold-bright)]">{item.label}</div>
              <div className="mt-1 text-sm text-neutral-500">{item.desc}</div>
            </a>
          ))}
        </div>

        {/* ── Competitions ─────────────────────────────────────── */}
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--gold)]">All Competitions</h2>
            <span className="h-px flex-1 bg-[#1c1c1c]" />
            <a
              href="/tournament/new"
              className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-4 py-1.5 text-[11.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
            >
              + New
            </a>
          </div>

          {compList.length === 0 ? (
            <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--gold)]/25 bg-[var(--gold)]/8 text-3xl shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
                🏆
              </div>
              <h3 className="text-lg font-black text-white">No competitions yet</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">
                Create one with the button above and it will appear here with its PIN.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
              <div className="grid grid-cols-[1fr_7rem_8rem_6rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                {['Competition', 'Status', 'PIN', 'Created'].map(h => (
                  <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Competition' ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              {compList.map((comp: any, i: number) => {
                // Same status vocabulary as the admin tee-sheet board.
                const chip = comp.status === 'active'
                  ? { label: 'Live',     cls: 'bg-[var(--green)]/10 text-[var(--green)]' }
                  : comp.status === 'complete'
                    ? { label: 'Complete', cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]' }
                    : { label: comp.status ?? 'Draft', cls: 'bg-[var(--gold)]/10 text-[var(--gold)]' };
                return (
                  <div
                    key={comp.id}
                    className={`grid grid-cols-[1fr_7rem_8rem_6rem] gap-4 items-center border-b border-[#1c1c1c] px-5 py-4 last:border-0 transition-colors hover:bg-white/3 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{comp.name}</div>
                      {comp.year && <div className="text-xs text-neutral-500">{comp.year}</div>}
                    </div>
                    <div className="text-center">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${chip.cls}`}>
                        {chip.label === 'Live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--green)]" />}
                        {chip.label}
                      </span>
                    </div>
                    <div className="text-center font-mono text-sm font-bold tracking-[3px] tabular-nums text-[var(--gold-bright)]">
                      {pinDisplay(comp.pin)}
                    </div>
                    <div className="text-center font-mono text-xs tabular-nums text-neutral-500">
                      {new Date(comp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Members ──────────────────────────────────────────── */}
        <div>
          <SectionHeading
            label="Members"
            hint={memberList.length > 30 ? `Showing 30 of ${memberList.length}` : `${memberList.length} total`}
          />
          <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
            <div className="grid grid-cols-[1fr_8rem_7rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
              {['Player', 'Handicap', 'Role'].map(h => (
                <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
              ))}
            </div>
            {memberList.slice(0, 30).map((m: any, i: number) => {
              const name = m.players?.display_name ?? '—';
              const isAdminRow = m.role === 'admin' || m.role === 'owner';
              return (
                <div
                  key={m.player_id}
                  className={`grid grid-cols-[1fr_8rem_7rem] gap-4 items-center border-b border-[#1c1c1c] px-5 py-3 last:border-0 transition-colors hover:bg-white/3 ${i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-black ${
                        isAdminRow
                          ? 'border-[var(--gold)]/45 bg-[#1a1a1a] text-[var(--gold-bright)]'
                          : 'border-[#1c1c1c] bg-[#111111] text-neutral-500'
                      }`}
                    >
                      {name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="truncate text-sm font-semibold text-white">{name}</div>
                  </div>
                  <div className="text-center font-mono text-sm tabular-nums text-neutral-400">
                    {m.players?.handicap_index != null ? m.players.handicap_index.toFixed(1) : '—'}
                  </div>
                  <div className="text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                        isAdminRow
                          ? 'bg-[var(--gold)]/10 text-[var(--gold)]'
                          : 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]'
                      }`}
                    >
                      {m.role}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SectionHeading ────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--gold)]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}
