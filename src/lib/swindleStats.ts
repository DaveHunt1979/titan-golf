import { supabase, fetchAllRows } from './supabase';

export type SwindleLeader = { playerId: string; name: string; value: number };
export type SwindleRoundRecord = {
  playerId: string; name: string; value: number;
  gameId: string; gameName: string; gameDate: string;
} | null;

export interface SwindleSeasonStats {
  gamesPlayed: number;
  moneyList: { playerId: string; name: string; earnings: number; wins: number; games: number }[];
  orderOfMerit: { playerId: string; name: string; points: number; appearances: number; average: number }[];
  eagles: SwindleLeader[];
  birdies: SwindleLeader[];
  pars: SwindleLeader[];
  blobs: SwindleLeader[];
  bestFront9: SwindleRoundRecord;
  worstFront9: SwindleRoundRecord;
  bestBack9: SwindleRoundRecord;
  worstBack9: SwindleRoundRecord;
  bestStableford: SwindleRoundRecord;
  worstStableford: SwindleRoundRecord;
  bestMedal: SwindleRoundRecord;
  worstMedal: SwindleRoundRecord;
}

const EMPTY_STATS: SwindleSeasonStats = {
  gamesPlayed: 0, moneyList: [], orderOfMerit: [],
  eagles: [], birdies: [], pars: [], blobs: [],
  bestFront9: null, worstFront9: null, bestBack9: null, worstBack9: null,
  bestStableford: null, worstStableford: null, bestMedal: null, worstMedal: null,
};

type Round = {
  gameId: string; playerId: string;
  front9: number; front9Holes: number; back9: number; back9Holes: number;
  fullPts: number; fullGross: number; holesPlayed: number;
  eagles: number; birdies: number; pars: number; blobs: number; oomPts: number;
};

// Order of Merit weighting mirrors the club's own spreadsheet: eagle=4,
// birdie=3, par=2, blob=-1 (a blob is a 0-point Stableford hole) — a
// separate scale from the raw Stableford points a hole actually scores.
function oomPoints(pts: number): number {
  if (pts >= 4) return 4;
  if (pts === 3) return 3;
  if (pts === 2) return 2;
  if (pts === 0) return -1;
  return 0;
}

// Every leaderboard/record in the app's Swindle "Season Stats" (admin +
// member screens) is built from this one pass over swindle_scores — same
// per-(game,player) round shape whether you want a money list, an Order of
// Merit table, an Eagles/Birdies/Pars/Blobs count, or a Best/Worst round
// record. Keeping it in one function means the admin screen, the member
// screen, and the "push to members" DM summary can never disagree.
export async function computeSwindleSeasonStats(societyId: string): Promise<SwindleSeasonStats> {
  const { data: gamesData } = await supabase
    .from('swindle_games')
    .select('id, name, game_date, entry_fee, prize_split, status, format')
    .eq('society_id', societyId);
  const games = (gamesData ?? []) as {
    id: string; name: string; game_date: string; entry_fee: number;
    prize_split: number[]; status: string; format: string;
  }[];
  if (!games.length) return EMPTY_STATS;

  const gameById: Record<string, (typeof games)[number]> = {};
  games.forEach(g => { gameById[g.id] = g; });
  const gameIds = games.map(g => g.id);

  // Paged, not a bare .select() — PostgREST caps an unbounded select at 1000
  // rows, and this reads EVERY hole of EVERY Swindle in the society: 18 rows
  // per player per game, so a season passes 1000 rows after roughly three
  // 20-player games. Truncated, whole rounds silently vanished from the
  // Order of Merit, Money List, birdie/par counts and best/worst records —
  // real season data, not just simulations.
  const [entries, scores] = await Promise.all([
    fetchAllRows<any>(
      (from, to) => supabase.from('swindle_entries').select('game_id, player_id, players(display_name)').in('game_id', gameIds).order('id').range(from, to)
    ),
    fetchAllRows<any>(
      (from, to) => supabase.from('swindle_scores').select('game_id, player_id, hole_number, gross_score, stableford_pts').in('game_id', gameIds).order('id').range(from, to)
    ),
  ]);

  const nameOf: Record<string, string> = {};
  entries.forEach(e => { nameOf[e.player_id] = e.players?.display_name ?? 'Unknown'; });

  const rounds: Record<string, Round> = {};
  scores.forEach(s => {
    const key = `${s.game_id}:${s.player_id}`;
    const r = rounds[key] ??= {
      gameId: s.game_id, playerId: s.player_id,
      front9: 0, front9Holes: 0, back9: 0, back9Holes: 0,
      fullPts: 0, fullGross: 0, holesPlayed: 0,
      eagles: 0, birdies: 0, pars: 0, blobs: 0, oomPts: 0,
    };
    const pts: number | null = s.stableford_pts;
    if (pts != null) {
      r.holesPlayed += 1;
      r.fullPts += pts;
      if (s.hole_number <= 9) { r.front9 += pts; r.front9Holes += 1; }
      else { r.back9 += pts; r.back9Holes += 1; }
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
    const a = seasonAgg[r.playerId] ??= { eagles: 0, birdies: 0, pars: 0, blobs: 0, oomPts: 0, games: new Set() };
    a.eagles += r.eagles; a.birdies += r.birdies; a.pars += r.pars; a.blobs += r.blobs; a.oomPts += r.oomPts;
    a.games.add(r.gameId);
  });

  const leaderboard = (pick: (a: (typeof seasonAgg)[string]) => number): SwindleLeader[] =>
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

  const recordFrom = (r: Round, value: number): NonNullable<SwindleRoundRecord> => {
    const g = gameById[r.gameId];
    return { playerId: r.playerId, name: nameOf[r.playerId] ?? 'Unknown', value, gameId: r.gameId, gameName: g?.name ?? '—', gameDate: g?.game_date ?? '' };
  };

  const bestOf = (rows: Round[], pick: (r: Round) => number, dir: 'max' | 'min'): SwindleRoundRecord => {
    let best: Round | null = null;
    let bestVal = 0;
    rows.forEach(r => {
      const v = pick(r);
      if (!best || (dir === 'max' ? v > bestVal : v < bestVal)) { best = r; bestVal = v; }
    });
    return best ? recordFrom(best, bestVal) : null;
  };

  const front9Rounds = allRounds.filter(r => r.front9Holes > 0);
  const back9Rounds  = allRounds.filter(r => r.back9Holes > 0);
  const fullRounds   = allRounds.filter(r => r.holesPlayed >= 18);
  const medalRounds  = fullRounds.filter(r => gameById[r.gameId]?.format === 'stroke');

  // Money list — completed games only, top N (N = prize_split.length) by
  // full-round Stableford, same pot/split math as admin/swindle.tsx.
  const earnings: Record<string, { earnings: number; wins: number; games: number }> = {};
  games.filter(g => g.status === 'complete').forEach(g => {
    const gameRounds = allRounds.filter(r => r.gameId === g.id).sort((a, b) => b.fullPts - a.fullPts);
    const entrantCount = entries.filter(e => e.game_id === g.id).length;
    const pot = entrantCount * (g.entry_fee ?? 0);
    const split = g.prize_split ?? [50, 30, 20];
    gameRounds.slice(0, split.length).forEach((r, i) => {
      const payout = Math.round(pot * (split[i] ?? 0) / 100 * 100) / 100;
      if (payout <= 0) return;
      const e = earnings[r.playerId] ??= { earnings: 0, wins: 0, games: 0 };
      e.earnings += payout; e.games += 1;
      if (i === 0) e.wins += 1;
    });
  });
  const moneyList = Object.entries(earnings)
    .map(([playerId, v]) => ({ playerId, name: nameOf[playerId] ?? 'Unknown', ...v }))
    .sort((a, b) => b.earnings - a.earnings);

  return {
    gamesPlayed: games.length,
    moneyList,
    orderOfMerit,
    eagles:  leaderboard(a => a.eagles),
    birdies: leaderboard(a => a.birdies),
    pars:    leaderboard(a => a.pars),
    blobs:   leaderboard(a => a.blobs),
    bestFront9:      bestOf(front9Rounds, r => r.front9, 'max'),
    worstFront9:     bestOf(front9Rounds, r => r.front9, 'min'),
    bestBack9:       bestOf(back9Rounds,  r => r.back9,  'max'),
    worstBack9:      bestOf(back9Rounds,  r => r.back9,  'min'),
    bestStableford:  bestOf(fullRounds, r => r.fullPts, 'max'),
    worstStableford: bestOf(fullRounds, r => r.fullPts, 'min'),
    bestMedal:       bestOf(medalRounds, r => r.fullGross, 'min'),
    worstMedal:      bestOf(medalRounds, r => r.fullGross, 'max'),
  };
}
