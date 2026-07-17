'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingBag, User, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';

const NAV = [
  {
    label: 'Rounds',
    items: [
      { label: 'My Round History', href: '/rounds' },
      { label: 'Round Detail', href: '/rounds' },
      { label: 'Compare Rounds', href: '/rounds' },
    ],
  },
  {
    label: 'Performance',
    items: [
      { label: 'Stats Overview', href: '/stats' },
      { label: 'Club Distances', href: '/stats' },
      { label: 'Handicap Trend', href: '/stats' },
      { label: 'Driving Chart', href: '/stats' },
    ],
  },
  {
    label: 'Tournament',
    items: [
      { label: 'Create Competition', href: '/tournament/new' },
      { label: 'Results Archive', href: '/tournament/archive' },
      { label: 'Live Leaderboard', href: '/leaderboard' },
      { label: 'Admin Panel', href: '/admin' },
    ],
  },
  {
    label: 'Leaderboards',
    items: [
      { label: 'Season', href: '/leaderboard' },
      { label: 'Monthly', href: '/leaderboard' },
      { label: 'Wall of Records', href: '/records' },
    ],
  },
  {
    label: 'My Profile',
    items: [
      { label: 'Profile', href: '/profile' },
      { label: 'My Stats', href: '/stats' },
      { label: 'Round History', href: '/rounds' },
      { label: 'Dashboard', href: '/dashboard' },
    ],
  },
];

export default function Navbar() {
  const [open, setOpen] = useState<string | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#1e2d3d] bg-[#070b10]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-screen-xl items-center justify-between px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo_trans.png" alt="Titan Golf" width={36} height={36} className="opacity-90" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-black tracking-tight text-[#D4AF37]">TITAN</span>
            <span className="text-lg font-black tracking-tight text-white">GOLF</span>
          </div>
        </Link>

        {/* Nav items */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => setOpen(item.label)}
              onMouseLeave={() => setOpen(null)}
            >
              <button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-600 text-slate-300 transition-colors hover:bg-white/5 hover:text-white">
                {item.label}
                <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open === item.label && (
                <div className="absolute left-0 top-full mt-1 w-52 rounded-xl border border-[#1e2d3d] bg-[#0f1923] py-2 shadow-2xl">
                  {item.items.map((sub) => (
                    <Link
                      key={sub.label}
                      href={sub.href}
                      className="block px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-[#D4AF37]"
                    >
                      {sub.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Shop */}
        <div className="hidden items-center md:flex">
          <div className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-600 text-slate-300 cursor-default">
            <ShoppingBag size={15} className="text-slate-400" />
            Shop
            <span className="rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#D4AF37]">
              Soon
            </span>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-sm font-700 text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
              >
                <User size={15} />
                Profile
              </Link>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 rounded-lg bg-[#1e2d3d] px-4 py-2 text-sm font-700 text-slate-300 transition-colors hover:bg-[#263545] hover:text-white"
              >
                <LogOut size={15} />
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="rounded-lg border border-[#D4AF37]/40 px-4 py-2 text-sm font-700 text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-700 text-[#070b10] transition-opacity hover:opacity-90"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
