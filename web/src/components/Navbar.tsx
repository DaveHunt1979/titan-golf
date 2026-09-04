'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { User, LogOut } from 'lucide-react';
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
  const pathname = usePathname();

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

  // The Newsreel is meant to read as a standalone printable report, not a page inside the wider site.
  if (pathname?.startsWith('/newsreel')) return null;

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#1c1c1c] bg-[#000000]/95 backdrop-blur-md">
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
              <button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-600 text-neutral-300 transition-colors hover:bg-white/5 hover:text-white">
                {item.label}
                <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {open === item.label && (
                // top-full + pt-1 (not mt-1) keeps this whole block, including
                // the small gap above the panel, inside the parent's hover
                // hit-box. A margin-based gap sits *outside* both the button
                // and this element, so a mouse moving diagonally toward a
                // link below could cross a dead strip that belongs to
                // neither, firing onMouseLeave and closing the menu before
                // the pointer ever reached it — reported as the dropdown
                // "disappearing when I get near".
                <div className="absolute left-0 top-full w-52 pt-1">
                  <div className="rounded-xl border border-[#1c1c1c] bg-[#111111] py-2 shadow-2xl">
                    {item.items.map((sub) => (
                      <Link
                        key={sub.label}
                        href={sub.href}
                        className="block px-4 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/5 hover:text-[#D4AF37]"
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
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
                className="flex items-center gap-2 rounded-lg bg-[#1c1c1c] px-4 py-2 text-sm font-700 text-neutral-300 transition-colors hover:bg-[#262626] hover:text-white"
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
                className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-700 text-[#000000] transition-opacity hover:opacity-90"
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
