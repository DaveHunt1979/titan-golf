// Shared Swindle vocabulary + season math for the web app.
//
// The season numbers (Order of Merit points, per-round aggregates, the
// completed-game payout Money List) were first written inline inside the
// public read-only /swindle/[societyId] page. The admin manage board needs
// the identical Money List, and this codebase has already been bitten once
// by the same scoring concept being re-derived three slightly different ways
// (see the 2026-08-24 calculation-engine consolidation). So the math lives
// here once and both pages call it — no second copy to drift.
//
// Pure functions only: no supabase import, so a server component and a
// client component can both use it. Callers do their own queries.
//
// web/ and app/ are separate projects with no cross-imports (same reason
// /newsreel doesn't import src/lib/scoring.ts), so the tee-snapshot builder
// below is a deliberate hand-kept mirror of src/lib/whs.ts's
// buildSwindleTeeSnapshot — keep the two in sync if either changes.

// ── Types ─────────────────────────────────────────────────────────────────────

export type SwindleGameLite = {
  id: string;
  name: string;
  game_date: string;
  entry_fee: number;
  prize_split: number[] | null;
  status: string;
  format: string;
};

export type SwindleScoreRow = {
  game_id: string;
  player_id: string;
  hole_number: number;
  gross_score: number | null;
  stableford_pts: number | null;
};

export type SwindleRound = {
  gameId: string; playerId: string;
  front9: number; front9Holes: number; back9: number; back9Holes: number;
  fullPts: number; fullGross: number; holesPlayed: number;
  eagles: number; birdies: number; pars: number; blobs: number; oomPts: number;
};

export type MoneyRow = {
  playerId: string;
  name: string;
  earnings: number;
  wins: number;
  games: number;
};

// ── Season math ───────────────────────────────────────────────────────────────

// Order of Merit scale — Eagle +4 / Birdie +3 / Par +2 / Blob −1, keyed off
// the stableford points already stored per hole rather than re-deriving
// score-vs-par, so it can never disagree with the leaderboard.
export function oomPoints(pts: number): number {
  if (pts >= 4) return 4;
  if (pts === 3) return 3;
  if (pts === 2) return 2;
  if (pts === 0) return -1;
  return 0;
}

// One row per (game, player) built from raw hole scores.
export function buildRounds(scores: SwindleScoreRow[]): Record<string, SwindleRound> {
  const rounds: Record<string, SwindleRound> = {};
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
  return rounds;
}

// Payout for one finishing position, rounded to the penny.
export function payoutFor(pot: number, splitPct: number | undefined): number {
  return Math.round(pot * (splitPct ?? 0) / 100 * 100) / 100;
}

// Season Money List — only COMPLETED games pay out. Ranking inside a game is
// by full stableford points, which is what the mobile admin hub and the
// public season page have always used for the payout preview.
export function computeMoneyList(
  games: SwindleGameLite[],
  allRounds: SwindleRound[],
  entrantCountByGame: Record<string, number>,
  nameOf: Record<string, string>,
): MoneyRow[] {
  const earnings: Record<string, { earnings: number; wins: number; games: number }> = {};

  games.filter(g => g.status === 'complete').forEach(g => {
    const gameRounds = allRounds.filter(r => r.gameId === g.id).sort((a, b) => b.fullPts - a.fullPts);
    const pot = (entrantCountByGame[g.id] ?? 0) * (g.entry_fee ?? 0);
    const split = g.prize_split ?? [50, 30, 20];
    gameRounds.slice(0, split.length).forEach((r, i) => {
      const payout = payoutFor(pot, split[i]);
      if (payout <= 0) return;
      const e = (earnings[r.playerId] ??= { earnings: 0, wins: 0, games: 0 });
      e.earnings += payout; e.games += 1;
      if (i === 0) e.wins += 1;
    });
  });

  return Object.entries(earnings)
    .map(([playerId, v]) => ({ playerId, name: nameOf[playerId] ?? 'Unknown', ...v }))
    .sort((a, b) => b.earnings - a.earnings);
}

// ── Creation options ──────────────────────────────────────────────────────────
// Mirrors app/(app)/swindle/create.tsx exactly — same four fixed splits, same
// allowances, same two prize-money methods. No custom-split editor by design.

export const HCP_ALLOWANCES = [
  { value: 100, label: 'Full',    desc: '100%'    },
  { value: 90,  label: '9/10',    desc: '90%'     },
  { value: 75,  label: '¾',       desc: '75%'     },
  { value: 0,   label: 'Scratch', desc: 'Off hcp' },
] as const;

export const PRIZE_SPLITS: { label: string; value: number[] }[] = [
  { label: '50 / 30 / 20',        value: [50, 30, 20]     },
  { label: '60 / 40',             value: [60, 40]         },
  { label: 'Winner takes all',    value: [100]            },
  { label: '40 / 30 / 20 / 10',   value: [40, 30, 20, 10] },
];

export const PRIZE_METHODS = [
  { value: 'collector', label: 'One Person Collects All',       desc: 'One person collects entry fees and pays out winners offline' },
  { value: 'direct',    label: 'People Pay Each Other Directly', desc: 'Everyone pays their share straight to the winners'          },
] as const;

export type PrizeMethod = (typeof PRIZE_METHODS)[number]['value'];

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export const CURRENCIES = ['£', '$', '€'] as const;

// Ambiguous glyphs (I/O/0/1) left out so a code read aloud in the clubhouse
// can't be mistyped — same alphabet the mobile creator uses.
export function genJoinCode(): string {
  return Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
}

// ── Tee snapshot (mirror of src/lib/whs.ts) ───────────────────────────────────

export type SwindleTeeSnapshot = {
  tee_name: string | null;
  gender: string | null;
  whs_enabled_at_start: boolean;
  handicap_index_at_start?: number | null;
  slope_at_start?: number | null;
  course_rating_at_start?: number | null;
  par_at_start?: number | null;
  playing_handicap_at_start?: number | null;
};

export function calculateWHSPlayingHandicap(
  handicapIndex: number, slopeRating: number, courseRating: number, par: number, allowancePct: number,
): number {
  const courseHandicapUnrounded = handicapIndex * (slopeRating / 113) + (courseRating - par);
  return Math.round(courseHandicapUnrounded * (allowancePct / 100));
}

// A swindle uses ONE shared tee the creator sets, but a round_player_tees row
// is still written per player so the scoring screens' existing WHS lookup
// never has to know the tee came from the game rather than the player.
export function buildSwindleTeeSnapshot(
  game: {
    tee_name: string | null; tee_gender: string | null; tee_par: number | null;
    course_rating: number | null; slope_rating: number | null;
    whs_enabled: boolean; hcp_allowance: number | null;
  },
  handicapIndex: number | null,
): SwindleTeeSnapshot | null {
  if (!game.tee_name) return null; // no shared tee configured — leave the round exactly as it was before this feature existed
  if (game.whs_enabled && handicapIndex != null && game.tee_par != null && game.course_rating != null && game.slope_rating != null) {
    return {
      tee_name: game.tee_name, gender: game.tee_gender,
      handicap_index_at_start: handicapIndex,
      slope_at_start: game.slope_rating,
      course_rating_at_start: game.course_rating,
      par_at_start: game.tee_par,
      playing_handicap_at_start: calculateWHSPlayingHandicap(
        handicapIndex, game.slope_rating, game.course_rating, game.tee_par, game.hcp_allowance ?? 100,
      ),
      whs_enabled_at_start: true,
    };
  }
  return { tee_name: game.tee_name, gender: game.tee_gender, whs_enabled_at_start: false };
}

// ── Display ───────────────────────────────────────────────────────────────────

// ONE status vocabulary for every Swindle screen on the web. Mobile is
// inconsistent about this across its three swindle screens; rather than try
// to reconcile that, web uses the same chip language already established by
// /admin and the admin tee-sheet board: green pulse = live, gold = open,
// dim neutral = finished.
export type StatusChip = { label: string; cls: string; live: boolean };

export function statusChip(status: string | null | undefined): StatusChip {
  if (status === 'in_progress') return { label: 'Live',     cls: 'bg-[var(--green)]/10 text-[var(--green)]',            live: true  };
  if (status === 'complete')    return { label: 'Complete', cls: 'bg-[#000000] text-neutral-500 border border-[#1c1c1c]', live: false };
  return { label: status === 'open' || !status ? 'Open' : status, cls: 'bg-[var(--gold)]/10 text-[var(--gold)]', live: false };
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtMoney(currency: string, amount: number): string {
  return `${currency}${amount.toFixed(2)}`;
}

export function ordinal(i: number): string {
  return `${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'}`;
}
