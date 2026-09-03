import { createServiceClient } from '@/lib/supabase/service';
import { Trophy, PoundSterling, Medal, Flag } from 'lucide-react';

// Public, no-login "season stats" page for a society's Swindle — same
// mechanism as /newsreel/[competitionId] (service-role client, no auth
// required, shareable link) but for the ongoing Swindle season rather
// than one finished tournament. Computation is self-contained rather than
// importing the RN app's src/lib/swindleStats.ts — web/ and app/ are
// separate projects with no cross-imports today (see newsreel's own note
// on why it doesn't import src/lib/scoring.ts either).

type Game = {
  id: string; name: string; game_date: string; entry_fee: number;
  prize_split: number[] | null; status: string; format: string;
};
type Entry = { game_id: string; player_id: string; players: { display_name: string }[] | null };
type ScoreRow = { game_id: string; player_id: string; hole_number: number; gross_score: number | null; stableford_pts: number | null };

type Round = {
  gameId: string; playerId: string;
  front9: number; front9Holes: number; back9: number; back9Holes: number;
  fullPts: number; fullGross: number; holesPlayed: number;
  eagles: number; birdies: number; pars: number; blobs: number; oomPts: number;
};
type LeaderRow = { playerId: string; name: string; value: number };
type RoundRecord = { playerId: string; name: string; value: number; gameName: string } | null;

function oomPoints(pts: number): number {
  if (pts >= 4) return 4;
  if (pts === 3) return 3;
  if (pts === 2) return 2;
  if (pts === 0) return -1;
  return 0;
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function SwindleSeasonPage({ params }: { params: Promise<{ societyId: string }> }) {
  const { societyId } = await params;
  const supabase = createServiceClient();

  const { data: society } = await supabase.from('societies').select('name').eq('id', societyId).maybeSingle();

  const { data: gamesData } = await supabase
    .from('swindle_games')
    .select('id, name, game_date, entry_fee, prize_split, status, format')
    .eq('society_id', societyId);
  const games = (gamesData ?? []) as Game[];
  const gameById: Record<string, Game> = {};
  games.forEach(g => { gameById[g.id] = g; });
  const gameIds = games.map(g => g.id);

  const [{ data: entriesData }, { data: scoresData }] = gameIds.length
    ? await Promise.all([
        supabase.from('swindle_entries').select('game_id, player_id, players(display_name)').in('game_id', gameIds),
        supabase.from('swindle_scores').select('game_id, player_id, hole_number, gross_score, stableford_pts').in('game_id', gameIds),
      ])
    : [{ data: [] as Entry[] }, { data: [] as ScoreRow[] }];
  const entries = (entriesData ?? []) as unknown as Entry[];
  const scores = (scoresData ?? []) as ScoreRow[];

  const nameOf: Record<string, string> = {};
  entries.forEach(e => { nameOf[e.player_id] = e.players?.[0]?.display_name ?? 'Unknown'; });

  const rounds: Record<string, Round> = {};
  scores.forEach(s => {
    const key = `${s.game_id}:${s.player_id}`;
    const r = (rounds[key] ??= {
      gameId: s.game_id, playerId: s.player_id,
      front9: 0, front9Holes: 0, back9: 0, back9Holes: 0,
      fullPts: 0, fullGross: 0, holesPlayed: 0,
      eagles: 0, birdies: 0, pars: 0, blobs: 0, oomPts: 0,
    });
    if (s.stableford_pts != null) {
      const pts = s.stableford_pts;
      r.holesPlayed += 1;
      r.fullPts += pts;
      if (s.hole_number <= 9) { r.front9 += pts; r.front9Holes += 1; } else { r.back9 += pts; r.back9Holes += 1; }
      if (pts >= 4) r.eagles += 1;
      else if (pts === 3) r.birdies += 1;
      else if (pts === 2) r.pars += 1;
      else if (pts === 0) r.blobs += 1;
      r.oomPts += oomPoints(pts);
    }
    if (s.gross_score != null) r.fullGross += s.gross_score;
  });
  const allRounds = Object.values(rounds);

  const seasonAgg: Record<string, { eagles: number; birdies: number; pars: number; blobs: number; oomPts: number; games: Set<string> }> = {};
  allRounds.forEach(r => {
    const a = (seasonAgg[r.playerId] ??= { eagles: 0, birdies: 0, pars: 0, blobs: 0, oomPts: 0, games: new Set() });
    a.eagles += r.eagles; a.birdies += r.birdies; a.pars += r.pars; a.blobs += r.blobs; a.oomPts += r.oomPts;
    a.games.add(r.gameId);
  });

  const leaderboard = (pick: (a: (typeof seasonAgg)[string]) => number): LeaderRow[] =>
    Object.entries(seasonAgg)
      .map(([playerId, a]) => ({ playerId, name: nameOf[playerId] ?? 'Unknown', value: pick(a) }))
      .filter(l => l.value > 0)
      .sort((a, b) => b.value - a.value);

  const orderOfMerit = Object.entries(seasonAgg)
    .map(([playerId, a]) => ({
      playerId, name: nameOf[playerId] ?? 'Unknown', points: a.oomPts,
      appearances: a.games.size, average: a.games.size ? Math.round((a.oomPts / a.games.size) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.points - a.points);

  const bestOf = (rows: Round[], pick: (r: Round) => number, dir: 'max' | 'min'): RoundRecord => {
    let best: Round | null = null;
    let bestVal = 0;
    rows.forEach(r => {
      const v = pick(r);
      if (!best || (dir === 'max' ? v > bestVal : v < bestVal)) { best = r; bestVal = v; }
    });
    if (!best) return null;
    const b = best as Round;
    return { playerId: b.playerId, name: nameOf[b.playerId] ?? 'Unknown', value: bestVal, gameName: gameById[b.gameId]?.name ?? '—' };
  };

  const front9Rounds = allRounds.filter(r => r.front9Holes > 0);
  const back9Rounds  = allRounds.filter(r => r.back9Holes > 0);
  const fullRounds   = allRounds.filter(r => r.holesPlayed >= 18);
  const medalRounds  = fullRounds.filter(r => gameById[r.gameId]?.format === 'stroke');

  const earnings: Record<string, { earnings: number; wins: number; games: number }> = {};
  games.filter(g => g.status === 'complete').forEach(g => {
    const gameRounds = allRounds.filter(r => r.gameId === g.id).sort((a, b) => b.fullPts - a.fullPts);
    const entrantCount = entries.filter(e => e.game_id === g.id).length;
    const pot = entrantCount * (g.entry_fee ?? 0);
    const split = g.prize_split ?? [50, 30, 20];
    gameRounds.slice(0, split.length).forEach((r, i) => {
      const payout = Math.round(pot * (split[i] ?? 0) / 100 * 100) / 100;
      if (payout <= 0) return;
      const e = (earnings[r.playerId] ??= { earnings: 0, wins: 0, games: 0 });
      e.earnings += payout; e.games += 1;
      if (i === 0) e.wins += 1;
    });
  });
  const moneyList = Object.entries(earnings)
    .map(([playerId, v]) => ({ playerId, name: nameOf[playerId] ?? 'Unknown', ...v }))
    .sort((a, b) => b.earnings - a.earnings);

  const records: { label: string; unit: string; color: string; rec: RoundRecord }[] = [
    { label: 'Best Stableford',   unit: 'pts', color: '#D4AF37', rec: bestOf(fullRounds, r => r.fullPts, 'max') },
    { label: 'Worst Stableford',  unit: 'pts', color: '#f87171', rec: bestOf(fullRounds, r => r.fullPts, 'min') },
    { label: 'Best Front 9',      unit: 'pts', color: '#a78bfa', rec: bestOf(front9Rounds, r => r.front9, 'max') },
    { label: 'Best Back 9',       unit: 'pts', color: '#a78bfa', rec: bestOf(back9Rounds, r => r.back9, 'max') },
    { label: 'Worst Front 9',     unit: 'pts', color: '#f87171', rec: bestOf(front9Rounds, r => r.front9, 'min') },
    { label: 'Worst Back 9',      unit: 'pts', color: '#f87171', rec: bestOf(back9Rounds, r => r.back9, 'min') },
    { label: 'Best Medal Round',  unit: '',    color: '#4ade80', rec: bestOf(medalRounds, r => r.fullGross, 'min') },
    { label: 'Worst Medal Round', unit: '',    color: '#f87171', rec: bestOf(medalRounds, r => r.fullGross, 'max') },
  ];

  const countBoards: { label: string; color: string; list: LeaderRow[] }[] = [
    { label: 'Eagles',  color: '#D4AF37', list: leaderboard(a => a.eagles) },
    { label: 'Birdies', color: '#4ade80', list: leaderboard(a => a.birdies) },
    { label: 'Pars',    color: '#60a5fa', list: leaderboard(a => a.pars) },
    { label: 'Blobs',   color: '#f87171', list: leaderboard(a => a.blobs) },
  ];

  const lastPlayed = games.length ? fmtDate(games.map(g => g.game_date).sort().at(-1) ?? null) : null;

  // Hero chips + stat tiles — pure re-presentation of the numbers already
  // computed above, no new queries.
  const societyName = (society as { name: string } | null)?.name ?? 'Titan Golf';
  const completedGames = games.filter(g => g.status === 'complete').length;
  const totalPaid = moneyList.reduce((s, p) => s + p.earnings, 0);

  const metaChips = [
    `${games.length} game${games.length === 1 ? '' : 's'} this season`,
    lastPlayed ? `Last played ${lastPlayed}` : null,
    orderOfMerit.length ? `${orderOfMerit.length} player${orderOfMerit.length === 1 ? '' : 's'} ranked` : null,
  ].filter(Boolean) as string[];

  const statTiles: { label: string; value: string | number; suffix?: string; gold?: boolean }[] = [
    { label: 'Games Played',  value: games.length },
    { label: 'Completed',     value: completedGames },
    { label: 'Rounds Logged', value: allRounds.length },
    { label: 'Prize Money',   value: `£${totalPaid.toFixed(2)}`, gold: true },
  ];

  return (
    <div className="relative">
      {/* Ambient gold wash behind the hero — same top-of-page treatment as the Locker Room. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(1100px_460px_at_80%_-14%,var(--gold-glow),transparent_62%)]"
      />

      <div className="relative mx-auto max-w-screen-xl px-6 py-12">

        {/* ── Hero ───────────────────────────────────────────── */}
        <div className="mb-4 overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
          <div className="flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:text-left">
            <div className="shrink-0">
              <div className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-[#D4AF37] bg-[#1a1a1a] text-[var(--gold-bright)] shadow-[0_0_0_5px_rgba(74,222,128,0.10),0_0_38px_-6px_rgba(212,175,55,0.55)]">
                <Trophy size={44} />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">{societyName}</div>
              <h1 className="mt-1.5 text-[44px] font-black leading-[0.95] tracking-tight text-white">The Swindle</h1>
              <div className="mt-1.5 text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">Season Stats</div>
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {metaChips.map(chip => (
                  <span
                    key={chip}
                    className="rounded-full border border-[#1c1c1c] bg-[#0a0a0a] px-2.5 py-1 text-[11px] font-semibold text-neutral-400"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {!games.length ? (
          <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#D4AF37]/25 bg-[#D4AF37]/8 text-[var(--gold-bright)] shadow-[0_0_38px_-10px_rgba(212,175,55,0.55)]">
              <Trophy size={28} />
            </div>
            <h3 className="text-lg font-black text-white">No swindles yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-400">Season stats will appear here once games are played.</p>
          </div>
        ) : (
          <>
            {/* ── Quick stats ──────────────────────────────────── */}
            <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#1c1c1c] sm:grid-cols-4">
              {statTiles.map(s => (
                <div key={s.label} className="bg-[#111111] px-4 py-3.5">
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{s.label}</div>
                  <div className={`mt-1.5 font-mono text-[26px] font-bold leading-none tabular-nums ${s.gold ? 'text-[var(--gold-bright)]' : 'text-white'}`}>
                    {s.value}
                    {s.suffix && <span className="ml-1 text-[12px] font-bold text-neutral-600">{s.suffix}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Order of Merit ───────────────────────────────── */}
            <div className="mb-8">
              <SectionHeading label="Order of Merit" hint="Eagle +4 · Birdie +3 · Par +2 · Blob −1" />
              <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
                <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem_5.5rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                  {['#', 'Player', 'Rounds', 'Avg', 'Points'].map(h => (
                    <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
                  ))}
                </div>
                {orderOfMerit.slice(0, 20).map((p, i) => (
                  <div
                    key={p.playerId}
                    className={`grid grid-cols-[2.5rem_1fr_5rem_5rem_5.5rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
                      i === 0 ? 'bg-[#D4AF37]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                    }`}
                  >
                    <div className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-neutral-500'}`}>
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`truncate text-sm font-semibold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{p.name}</span>
                      {i === 0 && <Medal size={13} className="shrink-0 text-[var(--gold-bright)]" />}
                    </div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.appearances}</div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.average}</div>
                    <div className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{p.points}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Money List ───────────────────────────────────── */}
            <div className="mb-8">
              <SectionHeading label="Money List" hint={totalPaid > 0 ? `£${totalPaid.toFixed(2)} paid out` : undefined} />
              <div className="overflow-hidden rounded-2xl border border-[#1c1c1c]">
                <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem_7rem] gap-4 border-b border-[#1c1c1c] bg-[#111111] px-5 py-3">
                  {['#', 'Player', 'Wins', 'Games', 'Earnings'].map(h => (
                    <div key={h} className={`text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600 ${h !== 'Player' ? 'text-center' : ''}`}>{h}</div>
                  ))}
                </div>
                {moneyList.length === 0 && (
                  <div className="bg-[#000000] px-5 py-8 text-center text-sm text-neutral-500">No completed games yet.</div>
                )}
                {moneyList.slice(0, 20).map((p, i) => (
                  <div
                    key={p.playerId}
                    className={`grid grid-cols-[2.5rem_1fr_5rem_5rem_7rem] items-center gap-4 border-b border-[#1c1c1c] px-5 py-4 transition-colors last:border-0 hover:bg-white/3 ${
                      i === 0 ? 'bg-[#D4AF37]/6' : i % 2 === 0 ? 'bg-[#000000]' : 'bg-[#0a0a0a]'
                    }`}
                  >
                    <div className={`text-center font-mono text-sm font-bold tabular-nums ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-neutral-500'}`}>
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`truncate text-sm font-semibold ${i === 0 ? 'text-[var(--gold-bright)]' : 'text-white'}`}>{p.name}</span>
                      {i === 0 && <PoundSterling size={13} className="shrink-0 text-[var(--gold-bright)]" />}
                    </div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.wins}</div>
                    <div className="text-center font-mono text-sm tabular-nums text-neutral-400">{p.games}</div>
                    <div className="text-center font-mono text-sm font-bold tabular-nums text-[var(--gold-bright)]">£{p.earnings.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Season Counts ────────────────────────────────── */}
            <div className="mb-8">
              <SectionHeading label="Season Counts" hint="Top 5 each" />
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {countBoards.map(board => (
                  <div
                    key={board.label}
                    className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5 transition-colors hover:border-neutral-700"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: board.color }} />
                      <span className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: board.color }}>{board.label}</span>
                    </div>
                    {board.list.length === 0 && <div className="text-xs text-neutral-600">—</div>}
                    {board.list.slice(0, 5).map((p, i) => (
                      <div
                        key={p.playerId}
                        className="flex items-center justify-between gap-2 border-b border-dashed border-[#1c1c1c] py-1.5 text-xs last:border-b-0"
                      >
                        <span className="min-w-0 truncate">
                          <span className="mr-1.5 font-mono tabular-nums text-neutral-600">{i + 1}</span>
                          <span className="text-neutral-300">{p.name}</span>
                        </span>
                        <span className="shrink-0 font-mono text-sm font-bold tabular-nums" style={{ color: board.color }}>{p.value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Records ──────────────────────────────────────── */}
            <div>
              <SectionHeading label="Records" hint={`${records.filter(r => r.rec).length} of ${records.length} set`} />
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {records.map(r => (
                  <div
                    key={r.label}
                    className="rounded-2xl border bg-[#111111] p-5 text-center transition-colors"
                    style={{ borderColor: r.rec ? `${r.color}44` : '#1c1c1c' }}
                  >
                    <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] text-neutral-600">{r.label}</div>
                    <div className="mt-2 font-mono text-[30px] font-bold leading-none tabular-nums" style={{ color: r.rec ? r.color : '#404040' }}>
                      {r.rec ? r.rec.value : '—'}
                      {r.rec && r.unit && <span className="ml-1 text-[12px] font-bold text-neutral-600">{r.unit}</span>}
                    </div>
                    <div className="mt-3 truncate text-sm font-semibold text-white">{r.rec ? r.rec.name : '—'}</div>
                    {r.rec && (
                      <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-neutral-600">
                        <Flag size={10} className="shrink-0" />
                        <span className="truncate">{r.rec.gameName}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── SectionHeading ────────────────────────────────────────────────────────────

function SectionHeading({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">{label}</h2>
      <span className="h-px flex-1 bg-[#1c1c1c]" />
      {hint && <span className="text-[11px] font-semibold text-neutral-600">{hint}</span>}
    </div>
  );
}
