'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Clock, Flag, Lock, Trash2, Users, Wind } from 'lucide-react';
import { fmtDate, ordinal, payoutFor, statusChip } from '@/lib/swindle';

// Per-game Swindle management — the admin half of app/(app)/swindle/[gameId].tsx.
// Deliberately NOT a second scoring screen: scoring stays in the app. This is
// the organiser's control panel (close registration, complete, side-pot
// winners, collector, who's paid, tee-time groups).
//
// Deferred as mobile-only side effects: the settlement DMs and the swindle
// chat post that mobile fires from its own "Mark Complete". They write to
// direct_messages / messages as the acting player and are part of the in-app
// inbox+chat experience, so completing a game from the web changes status
// only — see the note rendered next to the button.

type Game = {
  id: string;
  name: string;
  game_date: string;
  course_name: string | null;
  entry_fee: number;
  currency: string;
  prize_split: number[] | null;
  status: string;
  format: string;
  join_code: string | null;
  society_id: string | null;
  registration_closed_at: string | null;
  prize_money_method: 'collector' | 'direct' | null;
  collector_player_id: string | null;
  tee_name: string | null;
  tee_gender: string | null;
  tee_par: number | null;
  course_rating: number | null;
  slope_rating: number | null;
  whs_enabled: boolean | null;
  hcp_allowance: number | null;
  is_recurring: boolean | null;
  recurring_day: string | null;
  twos_enabled: boolean | null;
  twos_fee: number | null;
  ntp_hole: number | null;
  ntp_fee: number | null;
  ntp_winner_id: string | null;
  ld_hole: number | null;
  ld_fee: number | null;
  ld_winner_id: string | null;
};

type Entry = {
  player_id: string;
  display_name: string;
  handicap: number | null;
  paid: boolean;
  total_pts: number;
  net_total: number;
  holes_played: number;
};

type Group = {
  id: string;
  tee_time: string | null;
  course_tee: string | null;
  players: string[];
};

type ScoreRow = { player_id: string; hole_number: number; gross_score: number | null; stableford_pts: number | null };

export default function SwindleGameManagePage({
  params,
}: { params: Promise<{ societyId: string; gameId: string }> }) {
  const { societyId, gameId } = use(params);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [gate,    setGate]    = useState<'checking' | 'ok'>('checking');
  const [loading, setLoading] = useState(true);
  const [game,    setGame]    = useState<Game | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups,  setGroups]  = useState<Group[]>([]);
  const [twos,    setTwos]    = useState<{ player_id: string; name: string; hole_number: number }[]>([]);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [picking, setPicking] = useState<'ntp' | 'ld' | 'collector' | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<string | null>(null);

  // ── Gate: admin/owner of THIS society ───────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/auth/login'); return; }
      const { data: player } = await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle();
      if (!player) { router.replace('/dashboard'); return; }
      const { data: member } = await supabase
        .from('society_members').select('role')
        .eq('player_id', player.id).eq('society_id', societyId).maybeSingle();
      if (!member || !['admin', 'owner'].includes(member.role ?? '')) { router.replace('/dashboard'); return; }
      setGate('ok');
    })();
  }, [supabase, router, societyId]);

  const load = useCallback(async () => {
    const [{ data: gameData }, { data: entriesData }, { data: scoresData }, { data: groupsData }] = await Promise.all([
      supabase.from('swindle_games').select('*').eq('id', gameId).maybeSingle(),
      supabase.from('swindle_entries').select('player_id, handicap, paid').eq('game_id', gameId),
      supabase.from('swindle_scores').select('player_id, hole_number, gross_score, stableford_pts').eq('game_id', gameId),
      supabase.from('swindle_groups')
        .select('id, tee_time, course_tee, swindle_group_players(player_id, is_guest, guest_name)')
        .eq('game_id', gameId).order('tee_time'),
    ]);

    const g = gameData as Game | null;
    // A swindle from another society must never be manageable through this
    // society's URL — the RLS policies are society-scoped, so this only
    // stops a confusing dead-end, but it stops it early.
    if (!g || (g.society_id && g.society_id !== societyId)) {
      setGame(null); setLoading(false); return;
    }

    const rawEntries = (entriesData ?? []) as { player_id: string; handicap: number | null; paid: boolean }[];
    const scores     = (scoresData ?? []) as ScoreRow[];
    const rawGroups  = (groupsData ?? []) as unknown as {
      id: string; tee_time: string | null; course_tee: string | null;
      swindle_group_players: { player_id: string | null; is_guest: boolean | null; guest_name: string | null }[] | null;
    }[];

    // Bulk name lookup rather than an embedded players(...) — see the note in
    // the mobile screen: the embed silently breaks rosters under players' RLS.
    const ids = new Set<string>();
    rawEntries.forEach(e => ids.add(e.player_id));
    rawGroups.forEach(gr => (gr.swindle_group_players ?? []).forEach(gp => {
      if (!gp.is_guest && gp.player_id) ids.add(gp.player_id);
    }));
    const { data: namesData } = ids.size
      ? await supabase.from('players').select('id, display_name').in('id', [...ids])
      : { data: [] as { id: string; display_name: string }[] };
    const nameOf: Record<string, string> = {};
    for (const p of (namesData ?? []) as { id: string; display_name: string }[]) nameOf[p.id] = p.display_name;

    const totals: Record<string, number> = {};
    const nets:   Record<string, number> = {};
    const holes:  Record<string, number> = {};
    for (const s of scores) {
      totals[s.player_id] = (totals[s.player_id] ?? 0) + (s.stableford_pts ?? 0);
      nets[s.player_id]   = (nets[s.player_id]   ?? 0) + (s.gross_score ?? 0);
      holes[s.player_id]  = (holes[s.player_id]  ?? 0) + 1;
    }

    const built: Entry[] = rawEntries.map(e => ({
      player_id: e.player_id,
      display_name: nameOf[e.player_id] ?? 'Unknown',
      handicap: e.handicap,
      paid: !!e.paid,
      total_pts: totals[e.player_id] ?? 0,
      net_total: nets[e.player_id] ?? 0,
      holes_played: holes[e.player_id] ?? 0,
    }));
    // Same ordering rule as the app: stroke play ranks on lowest gross,
    // everything else on highest stableford, holes played as the tie-break.
    if ((g.format ?? 'stableford') === 'stroke') built.sort((a, b) => a.net_total - b.net_total || b.holes_played - a.holes_played);
    else built.sort((a, b) => b.total_pts - a.total_pts || b.holes_played - a.holes_played);

    setGame(g);
    setEntries(built);
    setGroups(rawGroups.map(gr => ({
      id: gr.id, tee_time: gr.tee_time, course_tee: gr.course_tee,
      players: (gr.swindle_group_players ?? []).map(gp =>
        gp.is_guest ? (gp.guest_name ?? 'Guest') : (nameOf[gp.player_id ?? ''] ?? 'Unknown')),
    })));

    // Two's detection: gross ≤ par − 2 on any hole, identical to the app.
    if (g.twos_enabled && g.course_name) {
      const { data: holeRows } = await supabase
        .from('course_holes').select('hole_number, par').eq('course_name', g.course_name);
      const parOf: Record<number, number> = {};
      for (const h of (holeRows ?? []) as { hole_number: number; par: number }[]) parOf[h.hole_number] = h.par;
      const found = scores
        .filter(s => s.gross_score != null && parOf[s.hole_number] != null && s.gross_score <= parOf[s.hole_number] - 2)
        .map(s => ({
          player_id: s.player_id,
          name: (nameOf[s.player_id] ?? 'Unknown').split(' ')[0],
          hole_number: s.hole_number,
        }))
        .sort((a, b) => a.hole_number - b.hole_number);
      setTwos(found);
    } else {
      setTwos([]);
    }

    setLoading(false);
  }, [supabase, gameId, societyId]);

  useEffect(() => { if (gate === 'ok') load(); }, [gate, load]);

  // ── Actions ─────────────────────────────────────────────────────────────
  async function patchGame(patch: Record<string, unknown>) {
    if (!game) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('swindle_games').update(patch).eq('id', game.id);
    if (err) setError(err.message);
    await load();
    setPicking(null);
    setBusy(false);
  }

  async function markPaid(playerId: string, paid: boolean) {
    if (!game) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('swindle_entries')
      .update({ paid, paid_at: paid ? new Date().toISOString() : null })
      .eq('game_id', game.id).eq('player_id', playerId);
    if (err) setError(err.message);
    await load();
    setBusy(false);
  }

  async function deleteGroup(groupId: string) {
    setBusy(true); setError(''); setConfirmGroup(null);
    // swindle_group_players cascades with the group.
    const { error: err } = await supabase.from('swindle_groups').delete().eq('id', groupId);
    if (err) setError(err.message);
    await load();
    setBusy(false);
  }

  if (gate !== 'ok' || loading) {
    return <div className="mx-auto max-w-screen-xl px-6 py-24 text-center text-sm text-neutral-500">Loading swindle…</div>;
  }

  if (!game) {
    return (
      <div className="mx-auto max-w-screen-xl px-6 py-24 text-center">
        <h1 className="text-lg font-black text-white">Swindle not found</h1>
        <p className="mt-1.5 text-sm text-neutral-500">It may have been deleted, or it belongs to another society.</p>
        <Link href={`/swindle/${societyId}/manage`} className="mt-6 inline-block text-[12px] font-black tracking-wide text-[var(--gold)] hover:text-[var(--gold-bright)]">
          ← Back to Swindle Manager
        </Link>
      </div>
    );
  }

  const chip     = statusChip(game.status);
  const currency = game.currency ?? '£';
  const split    = game.prize_split ?? [];
  const pot      = (game.entry_fee ?? 0) * entries.length;
  const isStroke = (game.format ?? 'stableford') === 'stroke';
  const paidCount = entries.filter(e => e.paid).length;
  const collector = entries.find(e => e.player_id === game.collector_player_id);
  const ntpWinner = entries.find(e => e.player_id === game.ntp_winner_id);
  const ldWinner  = entries.find(e => e.player_id === game.ld_winner_id);
  const twosPot   = game.twos_enabled ? (game.twos_fee ?? 0) * entries.length : 0;
  const uniqueTwos = new Set(twos.map(t => t.player_id)).size;
  const twosEach  = uniqueTwos > 0 ? twosPot / uniqueTwos : 0;
  const ntpPot    = game.ntp_hole ? (game.ntp_fee ?? 0) * entries.length : 0;
  const ldPot     = game.ld_hole  ? (game.ld_fee  ?? 0) * entries.length : 0;

  const statTiles: { label: string; value: string; purple?: boolean; gold?: boolean }[] = [
    { label: 'Entries',  value: String(entries.length) },
    { label: 'Pot',      value: `${currency}${pot.toFixed(2)}`, purple: true },
    { label: 'Entry Fee', value: `${currency}${Number(game.entry_fee ?? 0).toFixed(2)}` },
    { label: 'Paid',     value: `${paidCount} / ${entries.length}`, gold: paidCount === entries.length && entries.length > 0 },
  ];

  const metaChips = [
    fmtDate(game.game_date),
    game.course_name ?? 'Course TBC',
    isStroke ? 'Stroke Play' : 'Stableford',
    `${game.hcp_allowance ?? 100}% hcp`,
    game.whs_enabled ? 'WHS on' : 'WHS off',
    game.tee_name ? `${game.tee_name}${game.tee_gender ? ` (${game.tee_gender})` : ''} tee` : null,
    game.join_code ? `Code ${game.join_code}` : null,
    game.is_recurring ? `Weekly · ${game.recurring_day ?? ''}`.trim() : null,
    split.length ? `Split ${split.join('/')}%` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">
        <Link
          href={`/swindle/${societyId}/manage`}
          className="text-[11px] font-bold uppercase tracking-widest text-neutral-500 transition-colors hover:text-[var(--gold-bright)]"
        >
          ← Back to Swindle Manager
        </Link>

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="mt-5 mb-4 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111] p-6">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">Swindle</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${chip.cls}`}>
              {chip.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--green)]" />}
              {chip.label}
            </span>
            {game.registration_closed_at && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-neutral-500">
                <Lock size={10} /> Registration closed
              </span>
            )}
          </div>
          <h1 className="mt-1.5 text-[40px] font-black leading-[0.95] tracking-tight text-white">{game.name}</h1>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {metaChips.map(c => (
              <span key={c} className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400">{c}</span>
            ))}
          </div>
        </div>

        {/* ── Quick stats ────────────────────────────────────── */}
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
          {statTiles.map(s => (
            <div key={s.label} className="bg-[#111111] px-4 py-3.5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
              <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${
                s.purple ? 'text-[var(--purple)]' : s.gold ? 'text-[var(--gold-bright)]' : 'text-white'
              }`}>{s.value}</div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/8 px-4 py-3 text-sm text-[var(--red)]">{error}</div>
        )}

        {/* ── Organiser actions ──────────────────────────────── */}
        <SectionHeading label="Organiser Actions" />
        <div className="mb-8 rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => patchGame({ registration_closed_at: game.registration_closed_at ? null : new Date().toISOString() })}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2.5 text-[11.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-40"
            >
              <Lock size={13} /> {game.registration_closed_at ? 'Reopen Registration' : 'Close Registration'}
            </button>
            {game.status !== 'complete' ? (
              <button
                onClick={() => patchGame({ status: 'complete' })}
                disabled={busy}
                className="rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-5 py-2.5 text-[11.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110 disabled:opacity-40"
              >
                Mark Complete
              </button>
            ) : (
              <button
                onClick={() => patchGame({ status: 'open' })}
                disabled={busy}
                className="rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2.5 text-[11.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-40"
              >
                Reopen Game
              </button>
            )}
            {game.prize_money_method === 'collector' && (
              <button
                onClick={() => setPicking(picking === 'collector' ? null : 'collector')}
                disabled={busy || entries.length === 0}
                className="rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2.5 text-[11.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-40"
              >
                Collector: {collector ? collector.display_name.split(' ')[0] : 'Not set'}
              </button>
            )}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">
            Completing a game from the web sets its status only. The settlement inbox messages and the swindle chat post
            are still sent from the app&apos;s own Mark Complete — they post as the acting player into the in-app inbox and chat.
          </p>

          {picking === 'collector' && (
            <PickerList
              label="Who is collecting the entry fees?"
              options={entries.map(e => ({ id: e.player_id, label: e.display_name, active: e.player_id === game.collector_player_id }))}
              onPick={id => patchGame({ collector_player_id: id })}
              onClose={() => setPicking(null)}
            />
          )}
        </div>

        {/* ── Leaderboard + payment tracking ─────────────────── */}
        <SectionHeading
          label="Entrants"
          hint={`${entries.length} in · ${paidCount} settled`}
        />
        <div className="mb-8 overflow-hidden rounded-2xl border border-[#1c1c1c]">
          <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem_6rem_7rem] gap-3 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
            {['#', 'Player', 'Holes', isStroke ? 'Gross' : 'Points', 'Prize', game.prize_money_method === 'direct' ? 'Settled' : 'Paid'].map(h => (
              <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
            ))}
          </div>
          {entries.length === 0 && (
            <div className="bg-[#000000] px-5 py-8 text-center text-sm text-neutral-500">Nobody has joined yet.</div>
          )}
          {entries.map((e, i) => {
            const prize = payoutFor(pot, split[i]);
            return (
              <div
                key={e.player_id}
                className={`grid grid-cols-[2.5rem_1fr_5rem_5rem_6rem_7rem] items-center gap-3 border-b border-[#1c1c1c] px-5 py-3 transition-colors last:border-0 hover:bg-white/3 ${
                  i === 0 ? 'bg-[var(--gold)]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                }`}
              >
                <div className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-neutral-500'}`}>{i + 1}</div>
                <div className="min-w-0">
                  <div className={`truncate text-sm font-semibold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{e.display_name}</div>
                  {e.handicap != null && <div className="font-mono text-[11px] tabular-nums text-neutral-600">hcp {e.handicap}</div>}
                </div>
                <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{e.holes_played}</div>
                <div className="text-center font-mono text-sm font-bold tabular-nums text-white">{isStroke ? e.net_total : e.total_pts}</div>
                <div className="text-center font-mono text-sm font-bold tabular-nums text-[var(--purple)]">
                  {prize > 0 ? `${currency}${prize.toFixed(2)}` : '—'}
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => markPaid(e.player_id, !e.paid)}
                    disabled={busy}
                    className={`rounded-full border px-3 py-1 text-[11px] font-black tracking-wide transition-colors disabled:opacity-40 ${
                      e.paid
                        ? 'border-[var(--green)]/35 bg-[var(--green)]/10 text-[var(--green)]'
                        : 'border-[#1c1c1c] bg-[#000000] text-neutral-500 hover:border-neutral-700 hover:text-white'
                    }`}
                  >
                    {e.paid
                      ? (game.prize_money_method === 'direct' ? 'Settled' : 'Paid')
                      : (game.prize_money_method === 'direct' ? 'Mark Settled' : 'Mark Paid')}
                  </button>
                </div>
              </div>
            );
          })}
          {split.length > 0 && entries.length > 0 && (
            <div className="border-t border-[#1c1c1c] bg-[#111111] px-5 py-3 text-[11px] font-semibold text-neutral-500">
              Payout preview ·{' '}
              {split.map((pct, i) => (
                <span key={i} className="text-[var(--purple)]">
                  {i > 0 && <span className="text-neutral-600"> · </span>}
                  {ordinal(i)} {currency}{payoutFor(pot, pct).toFixed(2)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Side pots ──────────────────────────────────────── */}
        {(game.twos_enabled || game.ntp_hole || game.ld_hole) && (
          <>
            <SectionHeading label="Side Pots" />
            <div className="mb-8 grid gap-4 lg:grid-cols-3">
              {game.twos_enabled && (
                <SidePot
                  icon={<Flag size={16} />}
                  title="Two's Pot"
                  pot={twosPot > 0 ? `${currency}${twosPot.toFixed(2)}` : null}
                  sub={twos.length === 0 ? 'No twos scored yet' : `${uniqueTwos} winner${uniqueTwos === 1 ? '' : 's'} · ${currency}${twosEach.toFixed(2)} each`}
                >
                  {twos.map((t, i) => (
                    <div key={`${t.player_id}-${t.hole_number}-${i}`} className="flex items-center justify-between border-b border-dashed border-[#1c1c1c] py-1.5 text-xs last:border-0">
                      <span className="text-neutral-300">{t.name}</span>
                      <span className="font-mono tabular-nums text-neutral-500">Hole {t.hole_number}</span>
                    </div>
                  ))}
                </SidePot>
              )}

              {game.ntp_hole && (
                <SidePot
                  icon={<Flag size={16} />}
                  title={`Nearest the Pin · Hole ${game.ntp_hole}`}
                  pot={ntpPot > 0 ? `${currency}${ntpPot.toFixed(2)}` : null}
                  sub={ntpWinner ? `Winner: ${ntpWinner.display_name}` : 'No winner set'}
                >
                  <WinnerPicker
                    open={picking === 'ntp'}
                    onToggle={() => setPicking(picking === 'ntp' ? null : 'ntp')}
                    entries={entries}
                    currentId={game.ntp_winner_id}
                    onPick={id => patchGame({ ntp_winner_id: id })}
                    onClear={() => patchGame({ ntp_winner_id: null })}
                    disabled={busy || entries.length === 0}
                  />
                </SidePot>
              )}

              {game.ld_hole && (
                <SidePot
                  icon={<Wind size={16} />}
                  title={`Longest Drive · Hole ${game.ld_hole}`}
                  pot={ldPot > 0 ? `${currency}${ldPot.toFixed(2)}` : null}
                  sub={ldWinner ? `Winner: ${ldWinner.display_name}` : 'No winner set'}
                >
                  <WinnerPicker
                    open={picking === 'ld'}
                    onToggle={() => setPicking(picking === 'ld' ? null : 'ld')}
                    entries={entries}
                    currentId={game.ld_winner_id}
                    onPick={id => patchGame({ ld_winner_id: id })}
                    onClear={() => patchGame({ ld_winner_id: null })}
                    disabled={busy || entries.length === 0}
                  />
                </SidePot>
              )}
            </div>
          </>
        )}

        {/* ── Tee-time groups ────────────────────────────────── */}
        <SectionHeading label="Tee Time Groups" hint={groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'}` : 'None created'} />
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-8 text-center text-sm text-neutral-500">
            Groups are created by players in the app. Any you need to clear out will show here.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(gr => (
              <div key={gr.id} className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-[var(--purple)]" />
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{gr.tee_time ?? 'No time'}</span>
                  {gr.course_tee && <span className="text-[11px] font-semibold text-neutral-500">· {gr.course_tee}</span>}
                </div>
                <div className="mt-3 space-y-1">
                  {gr.players.length === 0 && <div className="text-xs text-neutral-600">Empty group</div>}
                  {gr.players.map((p, i) => (
                    <div key={`${gr.id}-${i}`} className="flex items-center gap-2 text-xs text-neutral-300">
                      <Users size={11} className="shrink-0 text-neutral-600" />
                      <span className="truncate">{p}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  {confirmGroup === gr.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => deleteGroup(gr.id)}
                        disabled={busy}
                        className="rounded-full bg-[var(--red)]/20 px-3 py-1.5 text-[11px] font-black text-[var(--red)] transition-colors hover:bg-[var(--red)]/30 disabled:opacity-40"
                      >
                        Yes, delete group
                      </button>
                      <button onClick={() => setConfirmGroup(null)} className="text-[11px] font-bold text-neutral-500 hover:text-white">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmGroup(gr.id)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-black tracking-wide text-[var(--red)] transition-colors hover:brightness-125"
                    >
                      <Trash2 size={12} /> Delete group
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--gold)]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}

function SidePot({
  icon, title, pot, sub, children,
}: { icon: React.ReactNode; title: string; pot: string | null; sub: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--purple)]">
          {icon}
          <span className="truncate text-[11px] font-black uppercase tracking-[0.13em]">{title}</span>
        </div>
        {pot && <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-[var(--purple)]">{pot}</span>}
      </div>
      <div className="mt-1.5 text-xs text-neutral-500">{sub}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function WinnerPicker({
  open, onToggle, entries, currentId, onPick, onClear, disabled,
}: {
  open: boolean; onToggle: () => void;
  entries: { player_id: string; display_name: string }[];
  currentId: string | null;
  onPick: (id: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onToggle}
          disabled={disabled}
          className="rounded-full border border-[#1c1c1c] bg-[#000000] px-3.5 py-1.5 text-[11px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-40"
        >
          {currentId ? 'Change winner' : 'Set winner'}
        </button>
        {currentId && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="rounded-full border border-[var(--red)]/30 bg-[#000000] px-3.5 py-1.5 text-[11px] font-black tracking-wide text-[var(--red)] transition-colors hover:bg-[var(--red)]/10 disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
      {open && (
        <PickerList
          label="Pick the winner"
          options={entries.map(e => ({ id: e.player_id, label: e.display_name, active: e.player_id === currentId }))}
          onPick={onPick}
          onClose={onToggle}
        />
      )}
    </div>
  );
}

function PickerList({
  label, options, onPick, onClose,
}: {
  label: string;
  options: { id: string; label: string; active: boolean }[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#1c1c1c]">
      <div className="flex items-center justify-between border-b border-[#1c1c1c] bg-[#0a0a0a] px-4 py-2">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-500">{label}</span>
        <button onClick={onClose} className="text-[11px] font-bold text-neutral-500 transition-colors hover:text-white">Close</button>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {options.length === 0 && <div className="bg-[#000000] px-4 py-4 text-center text-xs text-neutral-600">Nobody has joined yet.</div>}
        {options.map(o => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className={`flex w-full items-center justify-between border-b border-[#1c1c1c] px-4 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-white/3 ${
              o.active ? 'bg-[var(--gold)]/6 text-[var(--gold-bright)]' : 'bg-[#000000] text-white'
            }`}
          >
            <span className="min-w-0 truncate">{o.label}</span>
            {o.active && <span className="shrink-0 text-[10px] font-black uppercase tracking-widest">Current</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
