import Link from 'next/link';
import Image from 'next/image';
import { Trophy, BarChart2, Wifi, Award, Activity, Bot } from 'lucide-react';

const FEATURES = [
  { icon: <Trophy size={24} />, title: 'Tournament Builder', desc: 'Create competitions, set the draw, configure handicap allowances — all on the web. Players open the app on the day and everything is ready.' },
  { icon: <BarChart2 size={24} />, title: 'Deep Stats', desc: 'Club distances, driving accuracy, handicap trend, net scoring breakdown. Every round feeds the numbers automatically.' },
  { icon: <Wifi size={24} />, title: 'NFC Shot Logging', desc: 'Tap your club to a sticker on the grip. Shot logged instantly. Distance picked on the spot. No typing, no fuss.' },
  { icon: <Award size={24} />, title: 'Wall of Records', desc: 'Society-wide records for best gross, best stableford, most birdies. Break one and the app erupts in celebration.' },
  { icon: <Activity size={24} />, title: 'Live Leaderboard', desc: 'Watch scores come in hole by hole via Supabase Realtime. The web dashboard updates the moment a score is entered.' },
  { icon: <Bot size={24} />, title: 'Chip & Birdie', desc: 'Your AI caddie duo. Chip handles the data — club selection, carry distances, wind. Birdie handles the banter.' },
];

const STATS = [
  { value: '18', label: 'Holes tracked' },
  { value: '∞', label: 'Game formats' },
  { value: '2', label: 'AI caddies' },
  { value: '0', label: 'Handicap excuses' },
];

export default function HomePage() {
  return (
    <div className="flex flex-col">

      {/* Hero */}
      <section className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#D4AF37]/6 blur-[120px]" />
          <div className="absolute left-1/4 bottom-0 h-[300px] w-[300px] rounded-full bg-[#D4AF37]/4 blur-[80px]" />
        </div>

        {/* Logo mark */}
        <Image
          src="/logo_trans.png"
          alt="Titan Golf"
          width={80}
          height={80}
          className="mb-6 drop-shadow-[0_0_30px_rgba(212,175,55,0.4)]"
        />

        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/30 bg-[#D4AF37]/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-[#D4AF37]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
          Now live on iOS
        </div>

        <h1 className="relative max-w-4xl text-5xl font-black leading-tight tracking-tight text-white md:text-7xl">
          Golf society management,{' '}
          <span className="text-[#D4AF37]">finally done right.</span>
        </h1>

        <p className="relative mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          Titan Golf tracks every shot, runs every tournament format, and puts a full stats
          dashboard in your pocket — and on your screen. One platform, your whole society.
        </p>

        <div className="relative mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/signup"
            className="rounded-xl bg-[#D4AF37] px-8 py-4 text-base font-bold text-[#070b10] shadow-lg shadow-[#D4AF37]/20 transition-all hover:scale-105 hover:shadow-[#D4AF37]/30"
          >
            Start for free
          </Link>
          <Link
            href="/demo"
            className="rounded-xl border border-[#1e2d3d] px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-[#D4AF37]/40 hover:text-white"
          >
            See the dashboard →
          </Link>
        </div>

        {/* Stats row */}
        <div className="relative mt-20 flex flex-wrap justify-center gap-12">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-4xl font-black text-[#D4AF37]">{s.value}</div>
              <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-screen-xl">
          <div className="relative overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-1 shadow-2xl">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-1.5 border-b border-[#1e2d3d] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#f87171]" />
              <span className="h-3 w-3 rounded-full bg-[#fbbf24]" />
              <span className="h-3 w-3 rounded-full bg-[#4ade80]" />
              <div className="ml-4 flex-1 rounded-md bg-[#070b10] px-3 py-1 text-xs text-slate-500">
                titangolf.app/dashboard
              </div>
            </div>

            {/* Dashboard layout mockup */}
            <div className="grid grid-cols-12 gap-3 p-4">
              {/* Left panel */}
              <div className="col-span-3 flex flex-col gap-3">
                <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Live Round</div>
                  <div className="text-2xl font-black text-white">Hole 14</div>
                  <div className="text-sm text-slate-400">Par 4 · 387 yds</div>
                  <div className="mt-4 flex justify-between text-xs text-slate-500">
                    <span>Score</span><span className="font-bold text-white">+2</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>Stableford</span><span className="font-bold text-[#4ade80]">32 pts</span>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-slate-500">
                    <span>Putts</span><span className="font-bold text-white">24</span>
                  </div>
                </div>

                <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Chip Says</div>
                  <div className="text-sm leading-relaxed text-slate-300">
                    "Try your 7-iron here. 165y carry, slight crosswind right. Your avg with 7I is 168y."
                  </div>
                </div>
              </div>

              {/* Centre — course map placeholder */}
              <div className="col-span-6 overflow-hidden rounded-xl border border-[#1e2d3d] bg-[#070b10]">
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-slate-600">
                  <div className="text-5xl">🗺️</div>
                  <div className="text-sm font-semibold">Aerial course map</div>
                  <div className="text-xs">Apple Maps / Mapbox · live shot tracking</div>
                </div>
              </div>

              {/* Right panel */}
              <div className="col-span-3 flex flex-col gap-3">
                <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Leaderboard</div>
                  {[
                    { name: 'Rick', pts: 38 },
                    { name: 'Dave', pts: 34 },
                    { name: 'Ross', pts: 29 },
                  ].map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between py-1.5 border-b border-[#1e2d3d] last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{i + 1}</span>
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                      </div>
                      <span className={`text-sm font-bold ${i === 0 ? 'text-[#D4AF37]' : 'text-slate-300'}`}>{p.pts}pts</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-[#1e2d3d] bg-[#070b10] p-4">
                  <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Club Analytics</div>
                  {[
                    { club: '7I', carry: '165y', avg: '168y' },
                    { club: 'PW', carry: '130y', avg: '127y' },
                    { club: 'D', carry: '245y', avg: '251y' },
                  ].map((c) => (
                    <div key={c.club} className="flex items-center justify-between py-1.5 border-b border-[#1e2d3d] last:border-0">
                      <span className="text-xs font-bold text-[#D4AF37]">{c.club}</span>
                      <span className="text-xs text-slate-400">carry {c.carry}</span>
                      <span className="text-xs font-semibold text-white">avg {c.avg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-screen-xl">
          <div className="mb-14 text-center">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Everything you need</div>
            <h2 className="text-4xl font-black text-white">Built for serious societies.</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-6 transition-all hover:border-[#D4AF37]/30 hover:bg-[#121e2b]"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/20 bg-[#D4AF37]/8 text-[#D4AF37]">{f.icon}</div>
                <h3 className="mb-2 text-lg font-bold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#D4AF37]/5 p-12">
            <div className="mb-6 flex justify-center">
              <Image src="/logo_trans.png" alt="Titan Golf" width={64} height={64} className="opacity-90" />
            </div>
            <h2 className="mb-4 text-4xl font-black text-white">Ready to tee off?</h2>
            <p className="mb-8 text-slate-400">
              Free to start. No credit card. Download the iOS app and your society is live in minutes.
            </p>
            <Link
              href="/auth/signup"
              className="inline-block rounded-xl bg-[#D4AF37] px-10 py-4 text-base font-bold text-[#070b10] shadow-lg shadow-[#D4AF37]/20 transition-all hover:scale-105"
            >
              Create your society
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e2d3d] px-6 py-8 text-center text-xs text-slate-600">
        © 2026 Titan Golf · Built with ❤️ for golf societies
      </footer>
    </div>
  );
}
