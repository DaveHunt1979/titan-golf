import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

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
    .order('created_at', { ascending: true })
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

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">

      <div className="mb-10 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Season Records</div>
          <h1 className="mt-1 text-5xl font-black text-white">Tournament History</h1>
        </div>
        {isAdmin && (
          <a
            href="/tournament/new"
            className="rounded-xl bg-[#D4AF37] px-5 py-3 text-sm font-800 text-[#070b10] transition-opacity hover:opacity-90"
          >
            + New Competition
          </a>
        )}
      </div>

      {/* Champions Wall */}
      {years.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Champions</h2>
          <div className="space-y-4">
            {years.map(year => {
              const yc: Champion[] = (champions ?? []).filter((c: any) => c.year === year);
              const tour   = yc.find(c => c.award_name.toLowerCase().includes('tour') || c.award_name.toLowerCase().includes('champion'));
              const kronos = yc.find(c => c.award_name.toLowerCase().includes('kronos'));
              const others = yc.filter(c => c !== tour && c !== kronos);
              return (
                <div key={year} className="overflow-hidden rounded-2xl border border-[#D4AF37]/20 bg-[#0f1923]">
                  <div className="border-b border-[#D4AF37]/10 bg-[#D4AF37]/5 px-6 py-3">
                    <span className="text-sm font-black text-[#D4AF37] tracking-widest">{year}</span>
                  </div>
                  <div className="divide-y divide-[#1e2d3d]">
                    {tour && (
                      <div className="flex items-center gap-4 px-6 py-4">
                        <span className="text-2xl">🏆</span>
                        <div className="flex-1">
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{tour.award_name}</div>
                          <div className="mt-0.5 text-xl font-black text-white">{tour.winner_name}</div>
                          {tour.detail && <div className="mt-0.5 text-sm text-slate-400">{tour.detail}</div>}
                        </div>
                      </div>
                    )}
                    {kronos && (
                      <div className="flex items-center gap-4 px-6 py-4">
                        <span className="text-2xl">⚡</span>
                        <div className="flex-1">
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{kronos.award_name}</div>
                          <div className="mt-0.5 text-xl font-black text-white">{kronos.winner_name}</div>
                          {kronos.detail && <div className="mt-0.5 text-sm text-slate-400">{kronos.detail}</div>}
                        </div>
                      </div>
                    )}
                    {others.map((ch, i) => (
                      <div key={i} className="flex items-center gap-4 px-6 py-4">
                        <span className="text-2xl">🎖</span>
                        <div className="flex-1">
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{ch.award_name}</div>
                          <div className="mt-0.5 text-xl font-black text-white">{ch.winner_name}</div>
                          {ch.detail && <div className="mt-0.5 text-sm text-slate-400">{ch.detail}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active competitions */}
      {active.length > 0 && (
        <CompSection title="Active" comps={active} isAdmin={isAdmin} pinDisplay={pinDisplay} badge="LIVE" badgeColor="text-[#4ade80] border-[#4ade80]/30" />
      )}

      {/* Completed competitions */}
      {completed.length > 0 && (
        <CompSection title="Completed" comps={completed} isAdmin={isAdmin} pinDisplay={pinDisplay} badge="DONE" badgeColor="text-slate-500 border-slate-700" />
      )}

      {/* Draft competitions */}
      {draft.length > 0 && (
        <CompSection title="Draft" comps={draft} isAdmin={isAdmin} pinDisplay={pinDisplay} badge="DRAFT" badgeColor="text-[#D4AF37] border-[#D4AF37]/30" />
      )}

      {years.length === 0 && (comps ?? []).length === 0 && (
        <div className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-16 text-center">
          <div className="mb-3 text-5xl">🏆</div>
          <h3 className="text-xl font-bold text-white">No tournaments yet</h3>
          <p className="mt-2 text-slate-400">Create your first competition to get started.</p>
          {isAdmin && (
            <a href="/tournament/new" className="mt-6 inline-block rounded-xl bg-[#D4AF37] px-6 py-3 text-sm font-800 text-[#070b10]">
              Create Competition
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function CompSection({ title, comps, isAdmin, pinDisplay, badge, badgeColor }: {
  title: string; comps: Competition[]; isAdmin: boolean;
  pinDisplay: (pin: string | null | undefined) => string;
  badge: string; badgeColor: string;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h2>
      <div className="space-y-3">
        {comps.map(comp => (
          <div key={comp.id} className="rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white">{comp.name}</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-widest ${badgeColor}`}>{badge}</span>
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {new Date(comp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
              </div>
              {isAdmin && (
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">PIN</div>
                  <div className="mt-0.5 text-xl font-black tracking-[6px] text-[#D4AF37]">{pinDisplay(comp.pin)}</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
