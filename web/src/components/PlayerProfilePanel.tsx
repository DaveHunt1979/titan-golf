'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { X, MessageSquare, IdCard, History, Clock, UserPlus, Trash2 } from 'lucide-react';

type PlayerRow = {
  id: string;
  display_name: string | null;
  nickname: string | null;
  handicap_index: number | null;
};

type Profile = {
  player: PlayerRow;
  rounds: number;
  best: number | null;
  avg: number | null;
  /** Stableford total per round, oldest → newest, last 6 rounds. */
  trend: number[];
};

function initials(name: string | null | undefined) {
  return (name ?? '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Last-6-rounds Stableford trend, drawn the same way the mockup did it:
 * grid lines, gradient fill under the line, dots with the newest one solid.
 */
function TrendChart({ pts }: { pts: number[] }) {
  const w = 296, h = 108, pad = 8;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = Math.max(1, max - min);
  const stepX = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;

  const coords = pts.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;

  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-auto overflow-visible">
        <defs>
          <linearGradient id="teeTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--teal)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => {
          const y = pad + (h - pad * 2) * f;
          return <line key={f} x1={pad} y1={y} x2={w - pad} y2={y} stroke="#1c1c1c" strokeWidth={1} />;
        })}
        <path d={fillPath} fill="url(#teeTrendGrad)" />
        <path d={linePath} fill="none" stroke="var(--teal)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          return (
            <circle
              key={i}
              cx={c[0]} cy={c[1]} r={isLast ? 4 : 2.6}
              fill={isLast ? 'var(--teal)' : '#050908'}
              stroke={isLast ? '#050908' : 'var(--teal)'}
              strokeWidth={2}
            />
          );
        })}
      </svg>
      <div className="mt-1.5 flex justify-between">
        {pts.map((_, i) => (
          <span key={i} className="font-mono text-[9.5px] text-neutral-600">R{i + 1}</span>
        ))}
      </div>
    </>
  );
}

const SIDE_BUTTONS = [
  { key: 'tcard',    label: 'View T-Card',          Icon: IdCard,    danger: false },
  { key: 'history',  label: 'Scorecard History',    Icon: History,   danger: false },
  { key: 'move',     label: 'Move Tee Time',        Icon: Clock,     danger: false },
  { key: 'add',      label: 'Add to Group',         Icon: UserPlus,  danger: false },
  { key: 'withdraw', label: 'Withdraw From Round',  Icon: Trash2,    danger: true  },
];

export default function PlayerProfilePanel({
  playerId,
  societyName,
  onClose,
}: {
  playerId: string | null;
  societyName?: string | null;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  // Keyed by player so switching player clears the note without an effect.
  const [stubNote, setStubNote] = useState<{ pid: string; text: string } | null>(null);

  useEffect(() => {
    if (!playerId) return;

    let cancelled = false;
    (async () => {
      setLoading(true);

      const [{ data: p }, { data: holes }] = await Promise.all([
        supabase.from('players').select('id, display_name, nickname, handicap_index').eq('id', playerId).maybeSingle(),
        // Same source the profile page already uses for career stats: sum
        // match_holes.stableford_pts per match_id. No new scoring maths here.
        supabase.from('match_holes').select('match_id, stableford_pts, updated_at').eq('player_id', playerId),
      ]);

      if (cancelled) return;

      if (!p) { setProfile(null); setLoading(false); return; }

      const perMatch: Record<string, { pts: number; last: string }> = {};
      ((holes ?? []) as { match_id: string; stableford_pts: number | null; updated_at: string | null }[])
        .forEach(h => {
          if (h.stableford_pts == null) return;
          const row = (perMatch[h.match_id] ??= { pts: 0, last: '' });
          row.pts += h.stableford_pts;
          if ((h.updated_at ?? '') > row.last) row.last = h.updated_at ?? '';
        });

      const ordered = Object.values(perMatch).sort((a, b) => a.last.localeCompare(b.last));
      const totals = ordered.map(r => r.pts);

      setProfile({
        player: p as PlayerRow,
        rounds: totals.length,
        best: totals.length ? Math.max(...totals) : null,
        avg: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
        trend: totals.slice(-6),
      });
      setLoading(false);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const open = playerId != null;
  const hcp = profile?.player.handicap_index;
  const trendDelta = profile && profile.trend.length > 1
    ? profile.trend[profile.trend.length - 1] - profile.trend[0]
    : null;

  return (
    <aside
      className={`fixed inset-y-0 right-0 z-30 flex w-full max-w-[352px] flex-col border-l border-[#1c1c1c] bg-[#0a0a0a] transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      aria-hidden={!open}
    >
      <div className="flex justify-end px-5 pt-5">
        <button
          onClick={onClose}
          aria-label="Close player profile"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1c1c1c] bg-[#111111] text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
        >
          <X size={13} />
        </button>
      </div>

      {loading && !profile ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#D4AF37] border-t-transparent" />
        </div>
      ) : !profile ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-neutral-600">
          Select a player to see their card.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-8">

          {/* Hero */}
          <div className="border-b border-[#1c1c1c] px-6 pb-5 pt-1.5 text-center">
            <div className="relative mx-auto mb-3 flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#111111] text-[22px] font-black text-[#D4AF37]">
              {initials(profile.player.display_name)}
              {hcp != null && (
                <span className="absolute -right-2.5 -top-2 rounded-full border-2 border-[#0a0a0a] bg-[#4ade80] px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-[#052012]">
                  {hcp.toFixed(1)}
                </span>
              )}
            </div>
            <h2 className="text-[19px] font-black text-white">{profile.player.display_name ?? '—'}</h2>
            <div className="mb-3.5 text-xs text-neutral-600">
              {profile.player.nickname ? `${profile.player.nickname} · ` : ''}{societyName ?? 'Titan Golf'}
            </div>
            <button
              onClick={() => setStubNote({ pid: profile.player.id, text: 'Messaging lives in the app for now — not wired up on the web board yet.' })}
              className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37] px-5 py-2.5 text-[12.5px] font-black tracking-wide text-[#000000] transition-opacity hover:opacity-90"
            >
              <MessageSquare size={13} />
              Message
            </button>
          </div>

          {/* Side actions */}
          <div className="flex flex-col gap-1.5 border-b border-[#1c1c1c] p-4">
            {SIDE_BUTTONS.map(({ key, label, Icon, danger }) => (
              <button
                key={key}
                onClick={() => setStubNote({ pid: profile.player.id, text: `“${label}” isn’t wired up on the web board yet.` })}
                className={`group flex items-center gap-3 rounded-xl border border-[#1c1c1c] bg-[#111111] px-3.5 py-3 text-left text-[12.5px] font-semibold text-neutral-400 transition-colors hover:border-neutral-700 hover:bg-[#1a1a1a] ${danger ? 'hover:text-[#f87171]' : 'hover:text-white'}`}
              >
                <Icon size={15} className={`shrink-0 text-neutral-600 transition-colors ${danger ? 'group-hover:text-[#f87171]' : 'group-hover:text-[#D4AF37]'}`} />
                {label}
              </button>
            ))}
            {stubNote?.pid === profile.player.id && (
              <div className="px-1 pt-1 text-[11px] text-neutral-600">{stubNote.text}</div>
            )}
          </div>

          {/* Real stat tiles */}
          <div className="mx-4 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#1c1c1c] bg-[#1c1c1c]">
            {[
              { label: 'Rounds Played',  value: String(profile.rounds),                       gold: false },
              { label: 'Best Round',     value: profile.best != null ? `${profile.best}` : '—', gold: true  },
              { label: 'Average Points', value: profile.avg  != null ? `${profile.avg}`  : '—', gold: false },
              { label: 'Handicap Index', value: hcp != null ? hcp.toFixed(1) : '—',            gold: false },
            ].map(t => (
              <div key={t.label} className="bg-[#111111] px-3.5 py-3">
                <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-widest text-neutral-600">{t.label}</div>
                <div className={`font-mono text-[19px] font-bold tabular-nums ${t.gold ? 'text-[#D4AF37]' : 'text-white'}`}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* Real trend chart */}
          <div className="px-5 pb-2 pt-5">
            <div className="mb-2.5 flex items-baseline justify-between">
              <span className="text-[11.5px] font-bold text-neutral-400">Stableford — Last {profile.trend.length || 6} Rounds</span>
              {trendDelta != null && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--teal)' }}>
                  {trendDelta >= 0 ? '+' : ''}{trendDelta} pts
                </span>
              )}
            </div>
            {profile.trend.length > 1 ? (
              <TrendChart pts={profile.trend} />
            ) : (
              <div className="rounded-xl border border-[#1c1c1c] bg-[#111111] px-4 py-6 text-center text-xs text-neutral-600">
                Not enough scored rounds yet.
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
