import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      <div className="mb-10">
        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Admin Panel</div>
        <h1 className="mt-1 text-5xl font-black text-white">{(society as any)?.name ?? 'Society'}</h1>
        <p className="mt-2 text-slate-400">Welcome back, {firstName}. Manage your society from here.</p>
      </div>

      {/* Quick actions */}
      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: '🏆', label: 'New Competition',    href: '/tournament/new',    desc: 'Create a new season or casual comp'   },
          { icon: '📋', label: 'Tournament Archive',  href: '/tournament/archive', desc: 'All competitions, champions & PINs' },
          { icon: '🏌️', label: 'Leaderboard',        href: '/leaderboard',        desc: 'Live Kronos & team standings'        },
          { icon: '🔑', label: 'Codes & PINs',       href: '/admin/codes',        desc: 'Join codes, tournament PINs & more'  },
        ].map(item => (
          <a
            key={item.label}
            href={item.href}
            className="group rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30 hover:bg-[#121e2b]"
          >
            <div className="mb-3 text-3xl">{item.icon}</div>
            <div className="font-bold text-white transition-colors group-hover:text-[#D4AF37]">{item.label}</div>
            <div className="mt-1 text-sm text-slate-500">{item.desc}</div>
          </a>
        ))}
      </div>

      {/* Society join PIN — only this one stays on the main page */}
      <div className="mb-8 flex items-center justify-between rounded-2xl border border-[#D4AF37]/20 bg-[#0f1923] px-6 py-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Society Join PIN</div>
          <div className="mt-1 text-xs text-slate-600">New players enter this in the app to join</div>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-3xl font-black tracking-[6px] text-[#D4AF37]">
            {joinPin ? `${joinPin.slice(0, 3)} ${joinPin.slice(3)}` : '—'}
          </div>
          <a href="/admin/codes" className="rounded-lg border border-[#D4AF37]/30 px-3 py-1.5 text-xs font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10">
            All Codes →
          </a>
        </div>
      </div>

      {/* Competitions table */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">All Competitions</h2>
          <a
            href="/tournament/new"
            className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90"
          >
            + New
          </a>
        </div>

        {(comps ?? []).length === 0 ? (
          <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-10 text-center">
            <div className="text-3xl mb-3">🏆</div>
            <p className="text-slate-400">No competitions yet. Create one above.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
            <div className="grid grid-cols-[1fr_6rem_8rem_6rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
              {['Competition', 'Status', 'PIN', 'Created'].map(h => (
                <div key={h} className="text-xs font-bold uppercase tracking-widest text-slate-500">{h}</div>
              ))}
            </div>
            {(comps ?? []).map((comp: any, i: number) => {
              const statusColor = comp.status === 'active' ? 'text-[#4ade80]' : comp.status === 'complete' ? 'text-slate-500' : 'text-[#D4AF37]';
              return (
                <div
                  key={comp.id}
                  className={`grid grid-cols-[1fr_6rem_8rem_6rem] gap-4 items-center border-b border-[#1e2d3d] px-5 py-4 last:border-0 ${i % 2 === 0 ? 'bg-[#070b10]' : 'bg-[#0a0f17]'}`}
                >
                  <div className="font-semibold text-white">{comp.name}</div>
                  <div className={`text-sm font-bold uppercase ${statusColor}`}>{comp.status}</div>
                  <div className="font-black tracking-[4px] text-[#D4AF37] text-sm">{pinDisplay(comp.pin)}</div>
                  <div className="text-sm text-slate-500">
                    {new Date(comp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Players list */}
      <div>
        <h2 className="mb-4 text-lg font-black text-white">Members ({(players ?? []).length})</h2>
        <div className="overflow-hidden rounded-2xl border border-[#1e2d3d]">
          <div className="grid grid-cols-[1fr_8rem_6rem] gap-4 border-b border-[#1e2d3d] bg-[#0f1923] px-5 py-3">
            {['Player', 'Handicap', 'Role'].map(h => (
              <div key={h} className="text-xs font-bold uppercase tracking-widest text-slate-500">{h}</div>
            ))}
          </div>
          {(players ?? []).slice(0, 30).map((m: any, i: number) => (
            <div
              key={m.player_id}
              className={`grid grid-cols-[1fr_8rem_6rem] gap-4 items-center border-b border-[#1e2d3d] px-5 py-3 last:border-0 ${i % 2 === 0 ? 'bg-[#070b10]' : 'bg-[#0a0f17]'}`}
            >
              <div className="text-sm font-semibold text-white">{m.players?.display_name ?? '—'}</div>
              <div className="text-sm text-slate-400">{m.players?.handicap_index != null ? m.players.handicap_index.toFixed(1) : '—'}</div>
              <div className={`text-xs font-bold uppercase ${m.role === 'admin' || m.role === 'owner' ? 'text-[#D4AF37]' : 'text-slate-500'}`}>{m.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
