'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Coins, PoundSterling, Settings2, Trash2, UserMinus, UserPlus } from 'lucide-react';
import {
  buildRounds, computeMoneyList, fmtDate, payoutFor, statusChip,
  type MoneyRow, type SwindleGameLite, type SwindleScoreRow,
} from '@/lib/swindle';

// Admin Swindle manager — the web twin of app/(app)/admin/swindle.tsx's three
// tabs. Write actions go through the normal authenticated client: the
// 20260911000000_swindle_admin_rls migration added admin/owner UPDATE+DELETE
// policies on top of the existing creator-only ones, so any society admin can
// manage any swindle in their society, not just ones they created.

type GameRow = SwindleGameLite & {
  course_name: string | null;
  currency: string;
  join_code: string | null;
  registration_closed_at: string | null;
};

type MemberRow = {
  player_id: string;
  display_name: string;
  handicap_index: number | null;
  isSwindle: boolean;
};

type GameCard = {
  game: GameRow;
  entrantCount: number;
  pot: number;
  top: { name: string; pts: number; payout: number }[];
};

export default function SwindleManagePage({ params }: { params: Promise<{ societyId: string }> }) {
  const { societyId } = use(params);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [gate,        setGate]        = useState<'checking' | 'ok'>('checking');
  const [loading,     setLoading]     = useState(true);
  const [societyName, setSocietyName] = useState<string | null>(null);
  const [tab,         setTab]         = useState<'games' | 'money' | 'members'>('games');

  const [cards,     setCards]     = useState<GameCard[]>([]);
  const [moneyList, setMoneyList] = useState<MoneyRow[]>([]);
  const [members,   setMembers]   = useState<MemberRow[]>([]);
  const [busy,      setBusy]      = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error,     setError]     = useState('');

  // ── Gate: admin/owner of THIS society, same check as /admin ──────────────
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

      const { data: society } = await supabase.from('societies').select('name').eq('id', societyId).maybeSingle();
      setSocietyName((society as { name: string } | null)?.name ?? null);
      setGate('ok');
    })();
  }, [supabase, router, societyId]);

  const load = useCallback(async () => {
    const { data: gamesData } = await supabase
      .from('swindle_games')
      .select('id, name, game_date, course_name, entry_fee, currency, prize_split, status, format, join_code, registration_closed_at')
      .eq('society_id', societyId)
      .order('game_date', { ascending: false });

    const games = (gamesData ?? []) as GameRow[];
    const gameIds = games.map(g => g.id);

    const [{ data: entriesData }, { data: scoresData }] = gameIds.length
      ? await Promise.all([
          supabase.from('swindle_entries').select('game_id, player_id').in('game_id', gameIds),
          supabase.from('swindle_scores').select('game_id, player_id, hole_number, gross_score, stableford_pts').in('game_id', gameIds),
        ])
      : [{ data: [] as { game_id: string; player_id: string }[] }, { data: [] as SwindleScoreRow[] }];

    const entries = (entriesData ?? []) as { game_id: string; player_id: string }[];
    const scores  = (scoresData ?? []) as SwindleScoreRow[];

    // Names fetched as one bulk query rather than an embedded players(...)
    // on swindle_entries — an embed for anyone other than yourself has been
    // found to silently break the roster fetch under players' own RLS.
    const ids = [...new Set(entries.map(e => e.player_id))];
    const { data: namesData } = ids.length
      ? await supabase.from('players').select('id, display_name').in('id', ids)
      : { data: [] as { id: string; display_name: string }[] };
    const nameOf: Record<string, string> = {};
    for (const p of (namesData ?? []) as { id: string; display_name: string }[]) nameOf[p.id] = p.display_name;

    const entrantCountByGame: Record<string, number> = {};
    entries.forEach(e => { entrantCountByGame[e.game_id] = (entrantCountByGame[e.game_id] ?? 0) + 1; });

    const allRounds = Object.values(buildRounds(scores));

    setCards(games.map(game => {
      const entrantCount = entrantCountByGame[game.id] ?? 0;
      const pot = entrantCount * (game.entry_fee ?? 0);
      const split = game.prize_split ?? [50, 30, 20];
      const top = allRounds
        .filter(r => r.gameId === game.id)
        .sort((a, b) => b.fullPts - a.fullPts)
        .slice(0, 3)
        .map((r, i) => ({
          name: (nameOf[r.playerId] ?? 'Unknown').split(' ')[0],
          pts: r.fullPts,
          payout: payoutFor(pot, split[i]),
        }));
      return { game, entrantCount, pot, top };
    }));

    setMoneyList(computeMoneyList(games, allRounds, entrantCountByGame, nameOf));

    const { data: memData } = await supabase
      .from('society_members')
      .select('player_id, membership_types, players(display_name, handicap_index)')
      .eq('society_id', societyId);

    const built: MemberRow[] = ((memData ?? []) as unknown as {
      player_id: string;
      membership_types: string[] | null;
      players: { display_name: string | null; handicap_index: number | null }[] | { display_name: string | null; handicap_index: number | null } | null;
    }[]).map(m => {
      const p = Array.isArray(m.players) ? m.players[0] : m.players;
      return {
        player_id: m.player_id,
        display_name: p?.display_name ?? 'Unknown',
        handicap_index: p?.handicap_index ?? null,
        isSwindle: (m.membership_types ?? []).includes('swindle'),
      };
    });
    built.sort((a, b) => a.display_name.localeCompare(b.display_name));
    setMembers(built);

    setLoading(false);
  }, [supabase, societyId]);

  useEffect(() => { if (gate === 'ok') load(); }, [gate, load]);

  // ── Actions ─────────────────────────────────────────────────────────────
  async function markComplete(gameId: string) {
    setBusy(gameId); setError('');
    const { error: err } = await supabase.from('swindle_games').update({ status: 'complete' }).eq('id', gameId);
    if (err) setError(err.message);
    await load();
    setBusy(null);
  }

  async function deleteGame(gameId: string) {
    setBusy(gameId); setError(''); setConfirmId(null);
    // Entries / scores / groups cascade via their FKs.
    const { error: err } = await supabase.from('swindle_games').delete().eq('id', gameId);
    if (err) setError(err.message);
    await load();
    setBusy(null);
  }

  async function setSwindleAccess(playerId: string, grant: boolean) {
    setBusy(playerId); setError('');
    // Read-modify-write on the membership_types array, same as the mobile
    // admin screen — other membership types on the row must survive.
    const { data: cur } = await supabase
      .from('society_members').select('membership_types')
      .eq('society_id', societyId).eq('player_id', playerId).maybeSingle();
    const types: string[] = ((cur as { membership_types: string[] | null } | null)?.membership_types ?? []);
    const next = grant
      ? (types.includes('swindle') ? types : [...types, 'swindle'])
      : types.filter(t => t !== 'swindle');
    const { error: err } = await supabase.from('society_members')
      .update({ membership_types: next })
      .eq('society_id', societyId).eq('player_id', playerId);
    if (err) setError(err.message);
    await load();
    setBusy(null);
  }

  if (gate !== 'ok' || loading) {
    return <div className="mx-auto max-w-screen-xl px-6 py-24 text-center text-sm text-neutral-500">Loading swindle manager…</div>;
  }

  const currency = cards[0]?.game.currency ?? '£';
  const liveCount = cards.filter(c => c.game.status !== 'complete').length;
  const totalPaid = moneyList.reduce((s, p) => s + p.earnings, 0);
  const swindleMembers = members.filter(m => m.isSwindle);

  const statTiles: { label: string; value: string | number; gold?: boolean; purple?: boolean }[] = [
    { label: 'Swindles',      value: cards.length, gold: true },
    { label: 'Open / Live',   value: liveCount },
    { label: 'Members',       value: swindleMembers.length, gold: true },
    { label: 'Paid Out',      value: `${currency}${totalPaid.toFixed(2)}`, purple: true },
  ];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]">
                <Coins size={13} />
                Swindle Manager
              </div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">
                {societyName ?? 'Society'}
              </h1>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {[
                  `${cards.length} swindle${cards.length === 1 ? '' : 's'}`,
                  liveCount > 0 ? `${liveCount} open` : 'None open',
                  `${swindleMembers.length} with access`,
                ].map(chip => (
                  <span key={chip} className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400">
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:self-start">
              <Link
                href={`/swindle/${societyId}/create`}
                className="rounded-full bg-[linear-gradient(155deg,var(--gold-bright),var(--gold-deep))] px-6 py-2.5 text-center text-[12.5px] font-black tracking-wide text-[#181200] transition-[filter] hover:brightness-110"
              >
                + New Swindle
              </Link>
              <Link
                href={`/swindle/${societyId}`}
                className="rounded-full border border-[#1c1c1c] bg-[#111111] px-6 py-2.5 text-center text-[12.5px] font-black tracking-wide text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
              >
                Season Stats →
              </Link>
            </div>
          </div>
        </div>

        {/* ── Quick stats ────────────────────────────────────── */}
        <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
          {statTiles.map(s => (
            <div key={s.label} className="bg-[#111111] px-4 py-3.5">
              <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
              <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${
                s.purple ? 'text-[var(--purple)]' : s.gold ? 'text-[var(--gold-bright)]' : 'text-white'
              }`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {([
            { id: 'games'   as const, label: 'Games'      },
            { id: 'money'   as const, label: 'Money List' },
            { id: 'members' as const, label: 'Members'    },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full border px-5 py-2 text-[12px] font-black tracking-wide transition-colors ${
                tab === t.id
                  ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold-bright)]'
                  : 'border-[#1c1c1c] bg-[#111111] text-neutral-400 hover:border-neutral-700 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-[var(--red)]/30 bg-[var(--red)]/8 px-4 py-3 text-sm text-[var(--red)]">{error}</div>
        )}

        {/* ── Games ──────────────────────────────────────────── */}
        {tab === 'games' && (
          cards.length === 0 ? (
            <EmptyState
              title="No swindles yet"
              body="Create one with the button above — it appears here with its join code the moment it's saved."
            />
          ) : (
            <div className="space-y-4">
              {cards.map(({ game, entrantCount, pot, top }) => {
                const chip = statusChip(game.status);
                const split = game.prize_split ?? [];
                const isBusy = busy === game.id;
                return (
                  <div key={game.id} className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
                    <div className="flex items-start gap-4 border-b border-[#1c1c1c] px-5 py-4">
                      <span className="mt-1 h-8 w-1 shrink-0 rounded-full bg-[var(--purple)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-bold text-white">{game.name}</div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500">
                          {fmtDate(game.game_date)}{game.course_name ? ` · ${game.course_name}` : ''}
                          {game.join_code ? ` · code ${game.join_code}` : ''}
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${chip.cls}`}>
                        {chip.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--green)]" />}
                        {chip.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-px bg-[#1c1c1c] sm:grid-cols-4">
                      {[
                        { label: 'Entries', value: String(entrantCount) },
                        { label: 'Pot',     value: `${game.currency}${pot.toFixed(2)}`, purple: true },
                        { label: 'Entry',   value: `${game.currency}${Number(game.entry_fee ?? 0).toFixed(2)}` },
                        { label: 'Split',   value: split.length ? `${split.join('/')}%` : '—' },
                      ].map(cell => (
                        <div key={cell.label} className="bg-[#111111] px-4 py-3">
                          <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{cell.label}</div>
                          <div className={`mt-1 font-mono text-[17px] font-bold leading-none tabular-nums ${cell.purple ? 'text-[var(--purple)]' : 'text-white'}`}>
                            {cell.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {top.length > 0 && (
                      <div className="border-t border-[#1c1c1c]">
                        {top.map((p, i) => (
                          <div
                            key={`${game.id}-${i}`}
                            className={`grid grid-cols-[2rem_1fr_5rem_6rem] items-center gap-3 border-b border-[#1c1c1c] px-5 py-2.5 last:border-0 ${
                              i === 0 ? 'bg-[var(--gold)]/5' : ''
                            }`}
                          >
                            <span className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-neutral-500'}`}>{i + 1}</span>
                            <span className={`min-w-0 truncate text-sm font-semibold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{p.name}</span>
                            <span className="text-right font-mono text-sm tabular-nums text-neutral-400">{p.pts} pts</span>
                            <span className="text-right font-mono text-sm font-bold tabular-nums text-[var(--purple)]">
                              {p.payout > 0 ? `${game.currency}${p.payout.toFixed(2)}` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 border-t border-[#1c1c1c] px-5 py-3">
                      <Link
                        href={`/swindle/${societyId}/manage/${game.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2 text-[11.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
                      >
                        <Settings2 size={13} /> Manage
                      </Link>
                      {game.status !== 'complete' && (
                        <button
                          onClick={() => markComplete(game.id)}
                          disabled={isBusy}
                          className="rounded-full border border-[#1c1c1c] bg-[#000000] px-4 py-2 text-[11.5px] font-black tracking-wide text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white disabled:opacity-40"
                        >
                          Mark Complete
                        </button>
                      )}
                      {confirmId === game.id ? (
                        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--red)]/40 bg-[var(--red)]/8 px-3 py-1.5">
                          <span className="text-[11px] font-bold text-[var(--red)]">Delete &ldquo;{game.name}&rdquo;?</span>
                          <button
                            onClick={() => deleteGame(game.id)}
                            disabled={isBusy}
                            className="rounded-full bg-[var(--red)]/20 px-3 py-1 text-[11px] font-black text-[var(--red)] transition-colors hover:bg-[var(--red)]/30 disabled:opacity-40"
                          >
                            Yes, delete
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="text-[11px] font-bold text-neutral-500 transition-colors hover:text-white"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(game.id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--red)]/30 bg-[#000000] px-4 py-2 text-[11.5px] font-black tracking-wide text-[var(--red)] transition-colors hover:bg-[var(--red)]/10"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── Money List ─────────────────────────────────────── */}
        {tab === 'money' && (
          <div>
            <SectionHeading label="Money List" hint={totalPaid > 0 ? `${currency}${totalPaid.toFixed(2)} paid out` : 'Completed swindles only'} />
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
              <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem_7rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                {['#', 'Player', 'Wins', 'Games', 'Earnings'].map(h => (
                  <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              {moneyList.length === 0 && (
                <div className="bg-[#000000] px-5 py-8 text-center text-sm text-neutral-500">No completed games yet.</div>
              )}
              {moneyList.map((p, i) => (
                <div
                  key={p.playerId}
                  className={`grid grid-cols-[2.5rem_1fr_5rem_5rem_7rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
                    i === 0 ? 'bg-[var(--gold)]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                  }`}
                >
                  <div className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-neutral-500'}`}>{i + 1}</div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate text-sm font-semibold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{p.name}</span>
                    {i === 0 && <PoundSterling size={13} className="shrink-0 text-[var(--gold-bright)]" />}
                  </div>
                  <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.wins}</div>
                  <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.games}</div>
                  <div className="text-center font-mono text-sm font-bold tabular-nums text-[var(--purple)]">{currency}{p.earnings.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Members ────────────────────────────────────────── */}
        {tab === 'members' && (
          <div>
            <SectionHeading
              label="Swindle Access"
              hint={`${swindleMembers.length} of ${members.length} society member${members.length === 1 ? '' : 's'}`}
            />
            <p className="mb-3 text-sm text-neutral-500">
              Granting access adds <span className="font-mono text-neutral-400">swindle</span> to the member&apos;s membership types — the same
              flag the app checks before showing them the Swindle tab.
            </p>
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
              <div className="grid grid-cols-[1fr_7rem_9rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                {['Player', 'Handicap', 'Swindle'].map(h => (
                  <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
                ))}
              </div>
              {members.length === 0 && (
                <div className="bg-[#000000] px-5 py-8 text-center text-sm text-neutral-500">No society members yet.</div>
              )}
              {members.map((m, i) => (
                <div
                  key={m.player_id}
                  className={`grid grid-cols-[1fr_7rem_9rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-3 transition-colors last:border-0 hover:bg-white/3 ${
                    i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] font-black ${
                      m.isSwindle ? 'border-[var(--purple-border)] bg-[#1a1a1a] text-[var(--purple)]' : 'border-[#1c1c1c] bg-[#111111] text-neutral-500'
                    }`}>
                      {m.display_name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="truncate text-sm font-semibold text-white">{m.display_name}</div>
                  </div>
                  <div className="text-center font-mono text-sm tabular-nums text-neutral-400">
                    {m.handicap_index != null ? m.handicap_index.toFixed(1) : '—'}
                  </div>
                  <div className="flex justify-center">
                    <button
                      onClick={() => setSwindleAccess(m.player_id, !m.isSwindle)}
                      disabled={busy === m.player_id}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-black tracking-wide transition-colors disabled:opacity-40 ${
                        m.isSwindle
                          ? 'border-[var(--red)]/30 bg-[#000000] text-[var(--red)] hover:bg-[var(--red)]/10'
                          : 'border-[var(--purple-border)] bg-[var(--purple-dim)] text-[var(--purple)] hover:brightness-125'
                      }`}
                    >
                      {m.isSwindle ? <><UserMinus size={12} /> Remove</> : <><UserPlus size={12} /> Grant</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--gold)]/25 bg-[var(--gold)]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
        <Coins size={28} />
      </div>
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">{body}</p>
    </div>
  );
}
