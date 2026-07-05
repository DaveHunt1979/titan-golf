'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

const FORMATS = [
  { value: 'team_matchplay_4bbb', label: '4BBB Team Matchplay', desc: 'Two-player teams, best ball format' },
  { value: 'stableford',          label: 'Stableford',          desc: 'Individual points, higher is better' },
  { value: 'medal',               label: 'Medal (Strokeplay)',  desc: 'Individual gross score, lower is better' },
  { value: 'casual',              label: 'Casual Round',        desc: 'Informal, no league points' },
];

function genPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function NewTournamentPage() {
  const router = useRouter();
  const [name,     setName]     = useState('');
  const [year,     setYear]     = useState(new Date().getFullYear().toString());
  const [format,   setFormat]   = useState('team_matchplay_4bbb');
  const [pin,      setPin]      = useState(genPin);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Competition name is required.'); return; }
    setSaving(true);
    setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('You must be logged in.'); setSaving(false); return; }

    const { data: player } = await supabase
      .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
    if (!player) { setError('Player profile not found.'); setSaving(false); return; }

    const { data: member } = await supabase
      .from('society_members').select('role, society_id')
      .eq('player_id', player.id)
      .in('role', ['admin', 'owner'])
      .maybeSingle();

    if (!member) { setError('You need admin access to create competitions.'); setSaving(false); return; }

    const { error: err } = await supabase.from('competitions').insert({
      society_id: member.society_id,
      name: name.trim(),
      year: parseInt(year) || new Date().getFullYear(),
      format,
      status: 'draft',
      pin,
    });

    if (err) { setError(err.message); setSaving(false); return; }
    router.push('/tournament/archive');
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-10">
        <a href="/tournament/archive" className="text-sm text-[#D4AF37] hover:underline">← Back to Archive</a>
        <div className="mt-6 text-xs font-bold uppercase tracking-widest text-[#D4AF37]">Admin</div>
        <h1 className="mt-1 text-4xl font-black text-white">New Competition</h1>
      </div>

      <form onSubmit={create} className="space-y-6">

        {/* Name */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Competition Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Titan Tour 2027"
            required
            className="w-full rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-4 py-3 text-white placeholder-slate-600 focus:border-[#D4AF37]/50 focus:outline-none"
          />
        </div>

        {/* Year */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Year</label>
          <input
            value={year}
            onChange={e => setYear(e.target.value)}
            type="number"
            min="2020"
            max="2040"
            className="w-full rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-4 py-3 text-white placeholder-slate-600 focus:border-[#D4AF37]/50 focus:outline-none"
          />
        </div>

        {/* Format */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Format</label>
          <div className="space-y-2">
            {FORMATS.map(f => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFormat(f.value)}
                className={`w-full rounded-xl border px-5 py-4 text-left transition-all ${
                  format === f.value
                    ? 'border-[#D4AF37]/40 bg-[#D4AF37]/8'
                    : 'border-[#1e2d3d] bg-[#0f1923] hover:border-[#1e2d3d]/80'
                }`}
              >
                <div className={`font-bold ${format === f.value ? 'text-[#D4AF37]' : 'text-white'}`}>{f.label}</div>
                <div className="mt-0.5 text-sm text-slate-500">{f.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* PIN */}
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Join PIN</label>
          <div className="flex gap-3">
            <input
              value={`${pin.slice(0, 3)} ${pin.slice(3)}`}
              readOnly
              className="flex-1 rounded-xl border border-[#1e2d3d] bg-[#0a0f17] px-4 py-3 font-black tracking-[6px] text-[#D4AF37]"
            />
            <button
              type="button"
              onClick={() => setPin(genPin())}
              className="rounded-xl border border-[#1e2d3d] bg-[#0f1923] px-4 py-3 text-sm text-slate-400 hover:text-white"
            >
              Regenerate
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Players use this PIN in the app to join this competition.</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-xl bg-[#D4AF37] py-4 font-black text-[#070b10] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Competition'}
          </button>
          <a
            href="/tournament/archive"
            className="rounded-xl border border-[#1e2d3d] px-6 py-4 text-slate-400 hover:text-white"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
