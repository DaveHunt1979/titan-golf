import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: player } = await supabase
    .from('players')
    .select('name, handicap_index')
    .eq('auth_uid', user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Welcome back</div>
        <h1 className="mt-1 text-4xl font-black text-white">
          {player?.name ?? user.email}
        </h1>
        {player?.handicap_index != null && (
          <div className="mt-2 text-slate-400">
            Handicap Index: <span className="font-bold text-white">{player.handicap_index}</span>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: '🏌️', label: 'Round History', href: '/rounds', desc: 'View all your past rounds' },
          { icon: '📊', label: 'My Stats', href: '/stats', desc: 'Club distances, drives, putts' },
          { icon: '🏆', label: 'Leaderboard', href: '/leaderboard', desc: 'Season standings' },
          { icon: '🎖️', label: 'Wall of Records', href: '/records', desc: 'Society records' },
        ].map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="group rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30 hover:bg-[#121e2b]"
          >
            <div className="mb-3 text-3xl">{item.icon}</div>
            <div className="font-bold text-white group-hover:text-[#D4AF37] transition-colors">{item.label}</div>
            <div className="mt-1 text-sm text-slate-500">{item.desc}</div>
          </a>
        ))}
      </div>

      {/* Coming soon panel */}
      <div className="mt-8 rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-8 text-center">
        <div className="mb-2 text-2xl">🚧</div>
        <h2 className="text-lg font-bold text-white">Full dashboard coming soon</h2>
        <p className="mt-1 text-sm text-slate-400">
          Live round tracking, tournament builder, and aerial course map — all on the way.
        </p>
      </div>
    </div>
  );
}
