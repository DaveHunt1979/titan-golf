'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image src="/logo_trans.png" alt="Titan Golf" width={56} height={56} className="opacity-90" />
          <div className="text-center">
            <div className="text-xl font-black tracking-tight">
              <span className="text-[#D4AF37]">TITAN</span>
              <span className="text-white"> GOLF</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">Sign in to your account</div>
          </div>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl border border-[#1e2d3d] bg-[#0f1923] p-8">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-400">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20"
            />
          </div>

          <div className="mb-6">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-400">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-[#D4AF37]/50 focus:ring-1 focus:ring-[#D4AF37]/20"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#D4AF37] py-3 text-sm font-bold text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="font-semibold text-[#D4AF37] hover:underline">
            Get started
          </Link>
        </p>
      </div>
    </div>
  );
}
