'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, Check, RefreshCw, Share2 } from 'lucide-react';

interface Codes {
  societyId: string;
  societyName: string;
  joinPin: string;
  casualCode: string | null;
  tourCode: string | null;
  swindleCode: string | null;
  activeTournamentName: string | null;
  activeTournamentPin: string | null;
}

function genPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function AdminCodesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [codes,    setCodes]    = useState<Codes | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [copied,   setCopied]   = useState<string | null>(null);
  const [genning,  setGenning]  = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { router.push('/dashboard'); return; }

      const { data: member } = await supabase
        .from('society_members').select('role, society_id')
        .eq('player_id', player.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!member || !['admin', 'owner'].includes(member.role ?? '')) { router.push('/dashboard'); return; }

      const [{ data: society }, { data: activeComp }] = await Promise.all([
        supabase.from('societies').select('name, join_pin, casual_join_code, tour_join_code, swindle_join_code').eq('id', member.society_id).single(),
        supabase.from('competitions').select('name, pin').eq('society_id', member.society_id).eq('status', 'active').limit(1).maybeSingle(),
      ]);

      const raw = (s: any) => String(s ?? '').replace(/[^0-9a-zA-Z-]/g, '');

      setCodes({
        societyId:             member.society_id,
        societyName:           (society as any)?.name ?? '',
        joinPin:               raw((society as any)?.join_pin),
        casualCode:            (society as any)?.casual_join_code ?? null,
        tourCode:              (society as any)?.tour_join_code   ?? null,
        swindleCode:           (society as any)?.swindle_join_code ?? null,
        activeTournamentName:  (activeComp as any)?.name  ?? null,
        activeTournamentPin:   raw((activeComp as any)?.pin) || null,
      });
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function regenerateJoinPin() {
    if (!codes) return;
    setGenning(true);
    const newPin = genPin();
    await supabase.from('societies').update({ join_pin: newPin } as any).eq('id', codes.societyId);
    setCodes(c => c ? { ...c, joinPin: newPin } : c);
    setGenning(false);
  }

  function pinDisplay(pin: string | null | undefined) {
    const clean = String(pin ?? '').replace(/[^0-9]/g, '');
    if (clean.length >= 6) return `${clean.slice(0, 3)} ${clean.slice(3)}`;
    return clean || '—';
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
      </div>
    );
  }

  if (!codes) return null;

  const AREAS = [
    { key: 'casual',  label: 'Casual Golf',   code: codes.casualCode,  color: '#4ade80',  desc: 'Share with players joining the casual golf area' },
    { key: 'tour',    label: 'The Tour',       code: codes.tourCode,    color: '#D4AF37',  desc: 'Share with players joining the season tour'      },
    { key: 'swindle', label: 'The Swindle',    code: codes.swindleCode, color: '#a78bfa',  desc: 'Share with players joining the swindle'          },
  ];

  return (
    <div className="mx-auto max-w-screen-lg px-6 py-12">

      {/* Header */}
      <div className="mb-10">
        <Link href="/admin" className="text-sm text-[#D4AF37] hover:underline">← Back to Admin</Link>
        <div className="mt-6 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{codes.societyName}</div>
        <h1 className="mt-1 text-5xl font-black text-white">Codes &amp; PINs</h1>
        <p className="mt-2 text-slate-400">All join codes and PINs in one place. Share these with your players.</p>
      </div>

      {/* Society join PIN */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Society Join PIN</h2>
        <div className="rounded-2xl border border-[#D4AF37]/30 bg-[#0f1923] p-6">
          <p className="mb-4 text-sm text-slate-400">New players enter this 6-digit PIN in the Titan Golf app to join your society.</p>
          <div className="flex items-center justify-between gap-4">
            <div className="text-5xl font-black tracking-[8px] text-[#D4AF37]">
              {codes.joinPin ? pinDisplay(codes.joinPin) : '——'}
            </div>
            <div className="flex gap-2">
              {codes.joinPin && (
                <button
                  onClick={() => copy(codes.joinPin, 'joinPin')}
                  className="flex items-center gap-2 rounded-lg border border-[#D4AF37]/40 px-4 py-2.5 text-sm font-bold text-[#D4AF37] transition-colors hover:bg-[#D4AF37]/10"
                >
                  {copied === 'joinPin' ? <Check size={15} /> : <Copy size={15} />}
                  {copied === 'joinPin' ? 'Copied!' : 'Copy'}
                </button>
              )}
              <button
                onClick={regenerateJoinPin}
                disabled={genning}
                className="flex items-center gap-2 rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-2.5 text-sm font-bold text-slate-300 transition-colors hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={15} className={genning ? 'animate-spin' : ''} />
                {genning ? 'Generating…' : (codes.joinPin ? 'Regenerate' : 'Generate PIN')}
              </button>
            </div>
          </div>
          {codes.joinPin && (
            <div className="mt-4 rounded-lg border border-[#1e2d3d] bg-[#070b10] px-4 py-3 text-sm text-slate-400">
              Share message: <span className="text-slate-200">Join {codes.societyName} on Titan Golf — your PIN is: {pinDisplay(codes.joinPin)}</span>
              <button onClick={() => copy(`Join ${codes.societyName} on Titan Golf — your PIN is: ${pinDisplay(codes.joinPin)}`, 'joinMsg')} className="ml-3 text-[#D4AF37] hover:underline text-xs">
                {copied === 'joinMsg' ? '✓ Copied' : 'Copy message'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Active Tournament PIN */}
      {codes.activeTournamentName && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Active Tournament PIN</h2>
          <div className="rounded-2xl border border-[#4ade80]/30 bg-[#0f1923] p-6">
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#4ade80] animate-pulse" />
              <span className="text-sm font-bold text-[#4ade80]">LIVE</span>
            </div>
            <div className="text-lg font-bold text-white">{codes.activeTournamentName}</div>
            <p className="mt-1 mb-4 text-sm text-slate-400">Players enter this PIN to unlock the Tour tab in the app.</p>
            {codes.activeTournamentPin ? (
              <div className="flex items-center justify-between gap-4">
                <div className="text-5xl font-black tracking-[8px] text-[#4ade80]">
                  {codes.activeTournamentPin.split('').join('  ')}
                </div>
                <button
                  onClick={() => copy(codes.activeTournamentPin!, 'tourPin')}
                  className="flex items-center gap-2 rounded-lg border border-[#4ade80]/40 px-4 py-2.5 text-sm font-bold text-[#4ade80] transition-colors hover:bg-[#4ade80]/10"
                >
                  {copied === 'tourPin' ? <Check size={15} /> : <Copy size={15} />}
                  {copied === 'tourPin' ? 'Copied!' : 'Copy PIN'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No PIN set for this tournament.</p>
            )}
          </div>
        </section>
      )}

      {/* Membership area codes */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Membership Area Codes</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {AREAS.map(area => (
            <div
              key={area.key}
              className="rounded-2xl border bg-[#0f1923] p-6"
              style={{ borderColor: area.code ? `${area.color}44` : '#1e2d3d' }}
            >
              <div className="mb-1 text-xs font-bold uppercase tracking-widest" style={{ color: area.color }}>{area.label}</div>
              <div className="my-3 font-mono text-3xl font-black tracking-[4px]" style={{ color: area.code ? area.color : '#334155' }}>
                {area.code ?? '——'}
              </div>
              <p className="mb-4 text-xs text-slate-500">{area.desc}</p>
              {area.code ? (
                <button
                  onClick={() => copy(area.code!, area.key)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors"
                  style={{ borderColor: `${area.color}40`, color: area.color }}
                >
                  {copied === area.key ? <Check size={13} /> : <Copy size={13} />}
                  {copied === area.key ? 'Copied!' : 'Copy Code'}
                </button>
              ) : (
                <div className="rounded-lg border border-slate-700 px-3 py-2 text-center text-xs text-slate-600">
                  Run membership_areas migration
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <Link href="/tournament/archive" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#D4AF37] transition-colors">
        <Share2 size={14} />
        View all tournaments &amp; their PINs →
      </Link>
    </div>
  );
}
