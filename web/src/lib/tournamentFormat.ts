// Web mirror of the mobile app's src/lib/tournamentFormat.ts FORMAT_RULES
// registry (Rick's brief, section 9, 2026-08-24). The Next.js app is a
// separate TypeScript project and can't import across the repo root, so this
// is a hand-kept copy — the SAME seven formats, the same flags, the same
// defaults. Keep the two in sync whenever a format's identity/rules change.
//
// Before this file existed the web builder shipped its own smaller, drifted
// copy inline in tournament/new/page.tsx: it was missing `odd_titan`
// entirely and had no team/validation metadata at all, so a web-created
// tournament could not express the rules the mobile app enforces.

export type FormatId =
  | 'team_matchplay'
  | 'titan_way'
  | 'odd_titan'
  | 'ryder_cup'
  | 'stableford'
  | 'medal'
  | 'knockout';

export interface FormatRules {
  id: FormatId;
  label: string;                           // canonical display name — every screen reads this, never the raw id
  sub: string;                             // Tournament Builder picker description
  available: boolean;                      // false = "coming soon", disabled in the picker
  isTeamFormat: boolean;                   // gates Teams/Points/Sweep setup, 4BBB day-formats, the Team leaderboard tab
  individualBoardDefaultOn: boolean;       // Kronos/Individual standings board defaults ON when this format is picked
  individualBoardLabel: 'Kronos' | 'Individual';
  captainRotation: boolean;                // opening-rounds captain-pairing rule — Titan Way / Odd Titan
  finalDayKnockout: boolean;               // final day pairs by league position — Titan Way only
  lastDaySinglesOverride: boolean;         // last day auto-set to Singles @ 85% handicap
  minTeams: number | null;
  maxTeams: number | null;
  minPlayers: number | null;
  exactPlayersPerTeam: number | null;
  requiresEvenTeams: boolean;
  requiresOddTeams: boolean;
  wholeTournamentDraw: boolean;
  finalRoundStablefordTeamPoints: boolean;
  howItWorks: string[] | null;
  defaultDays: number;
  defaultDayFormat: string;                // a DayFormatId value — that type lives with the builder, cast at the boundary
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

export const FORMAT_IDS = Object.keys(FORMAT_RULES) as FormatId[];

// Unknown/legacy format values fall back to a safe, fully-individual rule set
// rather than throwing — every flag defaults off.
const FALLBACK_RULES: FormatRules = { ...FORMAT_RULES.stableford, id: 'stableford' };

export function getFormatRules(format: string | null | undefined): FormatRules {
  return (format && FORMAT_RULES[format as FormatId]) || FALLBACK_RULES;
}

export function individualBoardLabel(format: string | null | undefined): 'Kronos' | 'Individual' {
  return getFormatRules(format).individualBoardLabel;
}

export interface StructuralIssue { label: string; }

// Same format-driven structural constraints the mobile builder's Go Live and
// draw.tsx's pre-draw feasibility check both run, so a web-created tournament
// can never be structurally invalid by mobile's own rules.
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

// tournament_type is a coarser, legacy 3-value CHECK-constrained column that
// can't distinguish Titan Way / Odd Titan from Multi-Team Tour — all three
// collapse to 'titan_tour', exactly as the mobile builder does. Nothing should
// READ this column to decide team-ness; use getFormatRules(format) for that.
export function tournamentTypeFor(f: FormatId): 'ryder_cup' | 'titan_tour' | 'casual' {
  if (f === 'ryder_cup') return 'ryder_cup';
  return getFormatRules(f).isTeamFormat ? 'titan_tour' : 'casual';
}
