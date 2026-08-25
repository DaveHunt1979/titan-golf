import { createServiceClient } from '@/lib/supabase/service';
import { Trophy, PoundSterling } from 'lucide-react';

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

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-12">
      <div className="mb-10">
        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
          {(society as { name: string } | null)?.name ?? 'Titan Golf'}
        </div>
        <h1 className="mt-1 flex items-center gap-3 text-5xl font-black text-white">
          <Trophy size={36} className="text-[#a78bfa]" />
          <span>The Swindle — Season Stats</span>
        </h1>
        <p className="mt-2 text-neutral-400">
          {games.length} game{games.length === 1 ? '' : 's'} this season{lastPlayed ? ` · last played ${lastPlayed}` : ''}.
        </p>
      </div>

      {!games.length ? (
        <div className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-12 text-center">
          <div className="mb-3 flex justify-center"><Trophy size={36} className="text-[#a78bfa]/40" /></div>
          <h3 className="text-lg font-bold text-white">No swindles yet</h3>
          <p className="mt-1 text-sm text-neutral-400">Season stats will appear here once games are played.</p>
        </div>
      ) : (
        <div className="space-y-12">

          <section>
            <h2 className="mb-1 text-lg font-black text-white">Order of Merit</h2>
            <p className="mb-4 text-xs text-neutral-500">Eagle +4 · Birdie +3 · Par +2 · Blob −1</p>
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
              {orderOfMerit.slice(0, 20).map((p, i) => (
                <div key={p.playerId} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? 'border-t border-[#1c1c1c]' : ''} ${i === 0 ? 'bg-[#a78bfa]/8' : ''}`}>
                  <span className="w-6 text-center text-sm font-bold text-white">{i + 1}</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{p.name}</div>
                    <div className="text-xs text-neutral-500">{p.appearances} round{p.appearances !== 1 ? 's' : ''} · avg {p.average}</div>
                  </div>
                  <span className="text-lg font-black text-white">{p.points}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-white"><PoundSterling size={18} className="text-[#D4AF37]" /> Money List</h2>
            <div className="overflow-hidden rounded-2xl border border-[#1c1c1c] bg-[#111111]">
              {moneyList.length === 0 && <div className="p-6 text-center text-sm text-neutral-500">No completed games yet.</div>}
              {moneyList.slice(0, 20).map((p, i) => (
                <div key={p.playerId} className={`flex items-center gap-4 px-5 py-3 ${i > 0 ? 'border-t border-[#1c1c1c]' : ''}`}>
                  <span className="w-6 text-center text-sm font-bold text-white">{i + 1}</span>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{p.name}</div>
                    <div className="text-xs text-neutral-500">{p.wins} win{p.wins !== 1 ? 's' : ''} · {p.games} game{p.games !== 1 ? 's' : ''}</div>
                  </div>
                  <span className="text-lg font-black text-[#D4AF37]">£{p.earnings.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-black text-white">Season Counts</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {countBoards.map(board => (
                <div key={board.label} className="rounded-2xl border border-[#1c1c1c] bg-[#111111] p-5">
                  <div className="mb-3 text-sm font-bold" style={{ color: board.color }}>{board.label}</div>
                  {board.list.length === 0 && <div className="text-xs text-neutral-600">—</div>}
                  {board.list.slice(0, 5).map((p, i) => (
                    <div key={p.playerId} className="flex items-center justify-between py-1 text-xs">
                      <span className="truncate text-neutral-300">{i + 1}. {p.name}</span>
                      <span className="font-bold" style={{ color: board.color }}>{p.value}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-black text-white">Records</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {records.map(r => (
                <div key={r.label} className="rounded-2xl border bg-[#111111] p-6 text-center" style={{ borderColor: r.rec ? `${r.color}44` : '#1c1c1c' }}>
                  <div className="text-3xl font-black" style={{ color: r.color }}>{r.rec ? `${r.rec.value}${r.unit ? ` ${r.unit}` : ''}` : '—'}</div>
                  <div className="mt-1 text-xs font-bold uppercase tracking-widest text-neutral-500">{r.label}</div>
                  <div className="mt-2 text-sm font-semibold text-white">{r.rec ? r.rec.name : '—'}</div>
                  {r.rec && <div className="mt-1 text-xs text-neutral-600">{r.rec.gameName}</div>}
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
    </div>
  );
}
