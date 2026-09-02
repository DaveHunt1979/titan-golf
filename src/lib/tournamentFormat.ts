// Format-Specific Rule Architecture (Rick's brief, section 9, 2026-08-24) —
// before this, "is this a team format", Captain Rotation, Kronos naming,
// final-day knockout eligibility, and Go Live minimums were each decided by
// their own independently-written conditional scattered across build.tsx,
// draw.tsx and tour/index.tsx (three different membership lists that had
// already drifted apart — see project memory). One tournament format
// selection now flows through a single table: Available Rules ->
// Terminology -> Scoring Options -> Game Generation Rules -> Leaderboard
// Behaviour -> Validation, all read from here.
export type FormatId = 'team_matchplay' | 'titan_way' | 'odd_titan' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';

export interface FormatRules {
  id: FormatId;
  label: string;                        // canonical display name — every screen reads this, never the raw id
  sub: string;                          // Tournament Builder picker description
  available: boolean;                   // false = "coming soon", disabled in the picker
  isTeamFormat: boolean;                 // needs team assignment — gates Teams/Points/Sweep setup, 4BBB day-formats, even-team validation, the Team leaderboard tab
  individualBoardDefaultOn: boolean;     // Kronos/Individual standings board defaults ON when this format is picked
  individualBoardLabel: 'Kronos' | 'Individual';
  captainRotation: boolean;              // opening-rounds captain-pairing rule — Titan Way only (Rick's brief, section 9)
  finalDayKnockout: boolean;             // final day pairs by league position instead of round-robin — Titan Way only
  lastDaySinglesOverride: boolean;       // last day auto-set to Singles @ 85% handicap
  minTeams: number | null;               // Go Live validation + Builder team-count floor
  maxTeams: number | null;               // Go Live validation + Builder team-count ceiling — Titan Way only (Rick's brief, 2026-08-25)
  minPlayers: number | null;             // Go Live validation
  exactPlayersPerTeam: number | null;    // every team must have exactly this many active players — Titan Way only
  requiresEvenTeams: boolean;            // team count must be even — Titan Way only (the generic isMatchplay odd-team check in build.tsx predates this and stays as a fallback for other formats)
  requiresOddTeams: boolean;             // team count must be odd — Odd Titan only (Titan Way's knockout playoff needs even pairs; this format's final round doesn't pair teams at all, so odd is the whole point)
  wholeTournamentDraw: boolean;          // qualifying rounds generated together via titanWayDraw.ts's partnership optimizer, not day-by-day — Titan Way + Odd Titan
  finalRoundStablefordTeamPoints: boolean; // final round's team points = sum of each team's players' Stableford points that round, added to the Rounds 1-3 match-play total — Odd Titan only (Dave, 2026-09-02: odd team counts can't be bracketed 1v2/3v4 the way Titan Way locks final position, so the last round counts toward the same table instead of deciding it via a knockout)
  howItWorks: string[] | null;           // "HOW IT WORKS" expandable steps on the format card — Titan Way only
  defaultDays: number;
  defaultDayFormat: string;              // a DayFormatId value — that type stays owned by build.tsx (a separate, round-level axis), cast at the boundary
  defaultHcpPct: number;
  defaultPtsWin: number;
  defaultPtsHalf: number;
  defaultMaxHandicap: number | null;
}

export const FORMAT_RULES: Record<FormatId, FormatRules> = {
  team_matchplay: {
    id: 'team_matchplay',
    label: 'Multi-Team Tour',
    sub: 'Multiple teams battle across days. Mix 4BBB, foursomes and singles. Titan Tour style.',
    available: true,
    isTeamFormat: true,
    individualBoardDefaultOn: true,
    individualBoardLabel: 'Individual',
    captainRotation: false,
    finalDayKnockout: false,
    lastDaySinglesOverride: true,
    minTeams: null,
    maxTeams: null,
    minPlayers: null,
    exactPlayersPerTeam: null,
    requiresEvenTeams: false,
    requiresOddTeams: false,
    wholeTournamentDraw: false,
    finalRoundStablefordTeamPoints: false,
    howItWorks: null,
    defaultDays: 4,
    defaultDayFormat: 'four_bbb',
    defaultHcpPct: 75,
    defaultPtsWin: 1,
    defaultPtsHalf: 0.5,
    defaultMaxHandicap: null,
  },
  titan_way: {
    id: 'titan_way',
    label: 'Titan Way',
    // Rick's brief, 2026-08-25 — the format-card copy is sourced from these
    // same structural fields (minTeams/maxTeams/exactPlayersPerTeam) rather
    // than hardcoded twice, so the description can never drift from what
    // Go Live actually enforces.
    sub: 'Titan’s signature team tournament format. Play through mathematically generated 4BBB team rounds before the tournament moves into a final Singles Playoff. Final team positions determine who plays who, while Kronos performance determines the individual Singles matchups. 4–12 teams (even numbers only), exactly 4 players per team (16–48 players).',
    available: true,
    isTeamFormat: true,
    individualBoardDefaultOn: true,
    individualBoardLabel: 'Kronos',
    captainRotation: true,
    finalDayKnockout: true,
    lastDaySinglesOverride: true,
    minTeams: 4,
    maxTeams: 12,
    minPlayers: 16,
    exactPlayersPerTeam: 4,
    requiresEvenTeams: true,
    requiresOddTeams: false,
    wholeTournamentDraw: true,
    finalRoundStablefordTeamPoints: false,
    howItWorks: [
      'Build Your Teams — create an even number of teams with exactly four active players in each team.',
      'Titan Builds The Draw — Titan analyses the entire tournament and generates all scheduled 4BBB rounds together, maximising variety and minimising unnecessary repeat opponents and partnerships.',
      'Play The Team Rounds — team results build the Team Leaderboard, individual Stableford scores build the Kronos Individual Rankings.',
      'Final Team Positions — once every qualifying round is complete, Titan locks the final Team Rankings and pairs teams by finishing position (1st vs 2nd, 3rd vs 4th, 5th vs 6th, and so on).',
      'Kronos Sets The Singles Order — within each playoff, players are ranked by Kronos Individual Stableford performance. Highest plays highest, second plays second, and so on.',
      'The Final Showdown — the final round is Singles Matchplay. Every team has something to play for, and every player has earned their position through their tournament performance.',
    ],
    defaultDays: 4,
    defaultDayFormat: 'four_bbb',
    defaultHcpPct: 75,
    defaultPtsWin: 3,
    defaultPtsHalf: 1,
    defaultMaxHandicap: 18,
  },
  odd_titan: {
    id: 'odd_titan',
    label: 'Odd Titan',
    sub: 'Titan Way for an odd number of teams. Play through mathematically generated 4BBB team rounds, then a final Singles round whose Stableford points are added straight onto the Team Leaderboard rather than deciding a separate knockout. 3–11 teams (odd numbers only), exactly 4 players per team.',
    available: true,
    isTeamFormat: true,
    individualBoardDefaultOn: true,
    individualBoardLabel: 'Kronos',
    captainRotation: true,
    finalDayKnockout: false,
    lastDaySinglesOverride: true,
    minTeams: 3,
    maxTeams: 11,
    minPlayers: 12,
    exactPlayersPerTeam: 4,
    requiresEvenTeams: false,
    requiresOddTeams: true,
    wholeTournamentDraw: true,
    finalRoundStablefordTeamPoints: true,
    howItWorks: [
      'Build Your Teams — create an odd number of teams with exactly four active players in each team.',
      'Titan Builds The Draw — Titan analyses the entire tournament and generates all scheduled 4BBB rounds together, maximising variety and minimising unnecessary repeat opponents and partnerships.',
      'Play The Team Rounds — team results build the Team Leaderboard, individual Stableford scores build the Kronos Individual Rankings.',
      'The Final Round Is Singles — an odd number of teams can’t be bracketed 1v2, 3v4 the way Titan Way locks final position, so the last round pairs players across different teams instead, ranked by Kronos.',
      'Stableford Decides It — every player’s Stableford points from that final round are added up per team and go straight onto the Team Leaderboard alongside the match-play points from the earlier rounds, deciding the outright winner.',
    ],
    defaultDays: 4,
    defaultDayFormat: 'four_bbb',
    defaultHcpPct: 75,
    defaultPtsWin: 3,
    defaultPtsHalf: 1,
    defaultMaxHandicap: 18,
  },
  ryder_cup: {
    id: 'ryder_cup',
    label: 'Ryder Cup',
    sub: '2 sides, captain picks, team points. Perfect for a weekend away.',
    available: true,
    isTeamFormat: true,
    individualBoardDefaultOn: false,
    individualBoardLabel: 'Individual',
    captainRotation: false,
    finalDayKnockout: false,
    lastDaySinglesOverride: false,
    minTeams: null,
    maxTeams: null,
    minPlayers: null,
    exactPlayersPerTeam: null,
    requiresEvenTeams: false,
    requiresOddTeams: false,
    wholeTournamentDraw: false,
    finalRoundStablefordTeamPoints: false,
    howItWorks: null,
    defaultDays: 3,
    defaultDayFormat: 'four_bbb',
    defaultHcpPct: 75,
    defaultPtsWin: 1,
    defaultPtsHalf: 0.5,
    defaultMaxHandicap: null,
  },
  stableford: {
    id: 'stableford',
    label: 'Individual Stableford',
    sub: 'Everyone plays for themselves. Points per round build a season leaderboard.',
    available: true,
    isTeamFormat: false,
    individualBoardDefaultOn: false,
    individualBoardLabel: 'Individual',
    captainRotation: false,
    finalDayKnockout: false,
    lastDaySinglesOverride: false,
    minTeams: null,
    maxTeams: null,
    minPlayers: null,
    exactPlayersPerTeam: null,
    requiresEvenTeams: false,
    requiresOddTeams: false,
    wholeTournamentDraw: false,
    finalRoundStablefordTeamPoints: false,
    howItWorks: null,
    defaultDays: 4,
    defaultDayFormat: 'stableford',
    defaultHcpPct: 100,
    defaultPtsWin: 1,
    defaultPtsHalf: 0.5,
    defaultMaxHandicap: null,
  },
  medal: {
    id: 'medal',
    label: 'Stroke Play',
    sub: 'Lowest aggregate score wins. Multiple rounds, optional cut after round 2.',
    available: true,
    isTeamFormat: false,
    individualBoardDefaultOn: false,
    individualBoardLabel: 'Individual',
    captainRotation: false,
    finalDayKnockout: false,
    lastDaySinglesOverride: false,
    minTeams: null,
    maxTeams: null,
    minPlayers: null,
    exactPlayersPerTeam: null,
    requiresEvenTeams: false,
    requiresOddTeams: false,
    wholeTournamentDraw: false,
    finalRoundStablefordTeamPoints: false,
    howItWorks: null,
    defaultDays: 2,
    defaultDayFormat: 'medal',
    defaultHcpPct: 100,
    defaultPtsWin: 1,
    defaultPtsHalf: 0.5,
    defaultMaxHandicap: null,
  },
  knockout: {
    id: 'knockout',
    label: 'Knockout Bracket',
    sub: 'Seeded draw, head-to-head elimination rounds. Coming soon.',
    available: false,
    isTeamFormat: false,
    individualBoardDefaultOn: false,
    individualBoardLabel: 'Individual',
    captainRotation: false,
    finalDayKnockout: false,
    lastDaySinglesOverride: false,
    minTeams: null,
    maxTeams: null,
    minPlayers: null,
    exactPlayersPerTeam: null,
    requiresEvenTeams: false,
    requiresOddTeams: false,
    wholeTournamentDraw: false,
    finalRoundStablefordTeamPoints: false,
    howItWorks: null,
    defaultDays: 1,
    defaultDayFormat: 'singles',
    defaultHcpPct: 75,
    defaultPtsWin: 1,
    defaultPtsHalf: 0.5,
    defaultMaxHandicap: null,
  },
};

// Unknown/legacy format values (e.g. the pre-FormatId 'team_matchplay_4bbb'
// schema default, or a casual round's 'casual') fall back to a safe,
// fully-individual rule set rather than throwing — every flag defaults off.
const FALLBACK_RULES: FormatRules = {
  ...FORMAT_RULES.stableford,
  id: 'stableford',
};

export function getFormatRules(format: string | null | undefined): FormatRules {
  return (format && FORMAT_RULES[format as FormatId]) || FALLBACK_RULES;
}

export interface StructuralIssue { label: string; }

// Format-driven structural hard constraints (Rick's brief, 2026-08-25,
// section 21 — "Titan Way must reject the tournament configuration if...").
// Called from both build.tsx's Go Live validation and draw.tsx's pre-draw
// feasibility check so the two screens can never disagree about what's
// structurally valid. A no-op for any format that leaves these fields null/
// false (every format except Titan Way today).
export function checkTitanWayStructure(
  rules: FormatRules,
  teams: { id: string; playerCount: number }[],
): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  if (rules.minTeams != null && teams.length < rules.minTeams) {
    issues.push({ label: `${rules.label} needs at least ${rules.minTeams} teams — currently ${teams.length}` });
  }
  if (rules.maxTeams != null && teams.length > rules.maxTeams) {
    issues.push({ label: `${rules.label} allows at most ${rules.maxTeams} teams — currently ${teams.length}` });
  }
  if (rules.requiresEvenTeams && teams.length % 2 !== 0) {
    issues.push({ label: `${rules.label} needs an even number of teams — currently ${teams.length}` });
  }
  if (rules.requiresOddTeams && teams.length % 2 === 0) {
    issues.push({ label: `${rules.label} needs an odd number of teams — currently ${teams.length}` });
  }
  if (rules.exactPlayersPerTeam != null) {
    teams.forEach(t => {
      if (t.playerCount !== rules.exactPlayersPerTeam) {
        issues.push({ label: `Every team needs exactly ${rules.exactPlayersPerTeam} players — one team currently has ${t.playerCount}` });
      }
    });
  }
  return issues;
}

// Titan Way is the only tournament format that uses "Kronos" branding for the
// individual standings board — every other format shows the exact same
// underlying board, just labelled "Individual" (Rick's brief, 2026-08-22,
// section 4.4). One system, dynamic label — never a second leaderboard.
export function individualBoardLabel(format: string | null | undefined): 'Kronos' | 'Individual' {
  return getFormatRules(format).individualBoardLabel;
}

// Canonical match format naming (Rick's brief, section 8, 2026-08-24) —
// before this, the same match could be labelled "Singles" / "Singles
// Matchplay" / "Matchplay" / "MATCHPLAY" depending on which screen you were
// on, and 3 of those screens couldn't even tell Singles from 4BBB apart
// since they only read round_format (always 'matchplay' for all 4 formats).
// Every surface that shows a match/round format name should call this
// instead of deriving its own label.
export function matchFormatLabel(
  roundFormat: string | null | undefined,
  isSingles: boolean | null | undefined,
  handicapMethod: string | null | undefined,
): string {
  if (roundFormat === 'stableford') return 'Stableford';
  if (roundFormat === 'medal') return 'Stroke Play';
  if (roundFormat !== 'matchplay') return roundFormat ?? '';
  const stableford = handicapMethod === 'relative_low_stableford' || handicapMethod === 'individual_stableford';
  if (isSingles) return stableford ? 'Singles Match Play – Stableford' : 'Singles Match Play – Stroke Play';
  return stableford ? '4BBB Match Play – Stableford' : '4BBB Match Play – Stroke Play';
}
