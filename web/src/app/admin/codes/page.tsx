'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Copy, Check, RefreshCw, Share2, KeyRound, ArrowLeft } from 'lucide-react';

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
        .eq('player_id', player.id).order('joined_at', { ascending: true }).limit(1).maybeSingle();
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
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--gold)] border-t-transparent" />
      </div>
    );
  }

  if (!codes) return null;

  const AREAS = [
    { key: 'casual',  label: 'Casual Golf',   code: codes.casualCode,  color: '#4ade80',  desc: 'Share with players joining the casual golf area' },
    { key: 'tour',    label: 'The Tour',       code: codes.tourCode,    color: '#D4AF37',  desc: 'Share with players joining the season tour'      },
    { key: 'swindle', label: 'The Swindle',    code: codes.swindleCode, color: '#a78bfa',  desc: 'Share with players joining the swindle'          },
  ];

  const shareMessage = `Join ${codes.societyName} on Titan Golf — your PIN is: ${pinDisplay(codes.joinPin)}`;

  return (
    <div className="relative">
      {/* Ambient gold wash behind the header — same top-of-page treatment as the Locker Room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-lg px-6 py-12">

        {/* ── Header ─────────────────────────────────────────── */}
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-neutral-500 transition-colors hover:text-[var(--gold-bright)]"
        >
          <ArrowLeft size={13} />
          Back to Admin
        </Link>

        <div className="mb-8 mt-5 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
            <KeyRound size={13} />
            {codes.societyName || 'Society'}
          </div>
          <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">Codes &amp; PINs</h1>
          <p className="mt-3 text-sm text-neutral-400">
            All join codes and PINs in one place. Share these with your players.
          </p>
        </div>

        {/* ── Society join PIN ───────────────────────────────── */}
        <section className="mb-8">
          <SectionHeading label="Society Join PIN" hint="6 digits" />
          <div className="rounded-2xl border border-[var(--gold)]/25 bg-[#111111] p-6">
            <p className="text-sm text-neutral-400">
              New players enter this 6-digit PIN in the Titan Golf app to join your society.
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <div className="font-mono text-[46px] font-black leading-none tracking-[8px] tabular-nums text-[var(--gold-bright)]">
                {codes.joinPin ? pinDisplay(codes.joinPin) : '——'}
              </div>
              <div className="flex gap-2">
                {codes.joinPin && (
                  <button
                    onClick={() => copy(codes.joinPin, 'joinPin')}
                    className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
                  >
                    {copied === 'joinPin' ? <Check size={14} /> : <Copy size={14} />}
                    {copied === 'joinPin' ? 'Copied!' : 'Copy'}
                  </button>
                )}
                <button
                  onClick={regenerateJoinPin}
                  disabled={genning}
                  className="inline-flex items-center gap-2 rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-5 py-2.5 text-[12.5px] font-bold text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw size={14} className={genning ? 'animate-spin' : ''} />
                  {genning ? 'Generating…' : (codes.joinPin ? 'Regenerate' : 'Generate PIN')}
                </button>
              </div>
            </div>

            {codes.joinPin && (
              <div className="mt-5 rounded-xl border border-[#1c1c1c] bg-[#000000] px-4 py-3.5">
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">Share message</div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-neutral-200">{shareMessage}</span>
                  <button
                    onClick={() => copy(shareMessage, 'joinMsg')}
                    className="shrink-0 text-[11px] font-bold text-[var(--gold)] transition-colors hover:text-[var(--gold-bright)]"
                  >
                    {copied === 'joinMsg' ? '✓ Copied' : 'Copy message →'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Active tournament PIN ──────────────────────────── */}
        {codes.activeTournamentName && (
          <section className="mb-8">
            <SectionHeading label="Active Tournament PIN" />
            <div className="rounded-2xl border border-[var(--green)]/25 bg-[#111111] p-6">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--green)]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--green)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--green)]" />
                Live
              </span>
              <div className="mt-2.5 text-lg font-black text-white">{codes.activeTournamentName}</div>
              <p className="mt-1 text-sm text-neutral-400">Players enter this PIN to unlock the Tour tab in the app.</p>

              {codes.activeTournamentPin ? (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                  <div className="font-mono text-[46px] font-black leading-none tracking-[8px] tabular-nums text-[var(--green)]">
                    {codes.activeTournamentPin.split('').join('  ')}
                  </div>
                  <button
                    onClick={() => copy(codes.activeTournamentPin!, 'tourPin')}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--green)]/40 bg-[var(--green)]/5 px-5 py-2.5 text-[12.5px] font-bold text-[var(--green)] transition-colors hover:bg-[var(--green)]/12"
                  >
                    {copied === 'tourPin' ? <Check size={14} /> : <Copy size={14} />}
                    {copied === 'tourPin' ? 'Copied!' : 'Copy PIN'}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-neutral-500">No PIN set for this tournament.</p>
              )}
            </div>
          </section>
        )}

        {/* ── Membership area codes ──────────────────────────── */}
        <section className="mb-8">
          <SectionHeading label="Membership Area Codes" hint={`${AREAS.filter(a => a.code).length} of 3 set`} />
          <div className="grid gap-4 sm:grid-cols-3">
            {AREAS.map(area => (
              <div
                key={area.key}
                className="rounded-2xl border bg-[#111111] p-5 transition-colors"
                style={{ borderColor: area.code ? `${area.color}40` : '#1c1c1c' }}
              >
                <div className="text-[9.5px] font-bold uppercase tracking-[0.13em]" style={{ color: area.code ? area.color : '#525252' }}>
                  {area.label}
                </div>
                <div
                  className="mt-2 font-mono text-[30px] font-black leading-none tracking-[4px] tabular-nums"
                  style={{ color: area.code ? area.color : '#333333' }}
                >
                  {area.code ?? '——'}
                </div>
                <p className="mt-3 text-xs text-neutral-500">{area.desc}</p>

                {area.code ? (
                  <button
                    onClick={() => copy(area.code!, area.key)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border px-3 py-2 text-[11.5px] font-bold transition-colors"
                    style={{ borderColor: `${area.color}40`, color: area.color }}
                  >
                    {copied === area.key ? <Check size={13} /> : <Copy size={13} />}
                    {copied === area.key ? 'Copied!' : 'Copy Code'}
                  </button>
                ) : (
                  <div className="mt-4 rounded-full border border-[#1c1c1c] bg-[#000000] px-3 py-2 text-center text-[11px] font-semibold text-neutral-600">
                    Run membership_areas migration
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <Link
          href="/tournament/archive"
          className="inline-flex items-center gap-2 rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-4 py-2.5 text-[12px] font-bold text-neutral-400 transition-colors hover:border-neutral-700 hover:text-[var(--gold-bright)]"
        >
          <Share2 size={14} />
          View all tournaments &amp; their PINs →
        </Link>
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
