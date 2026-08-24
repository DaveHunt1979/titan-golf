// Format-Specific Rule Architecture (Rick's brief, section 9, 2026-08-24) —
// before this, "is this a team format", Captain Rotation, Kronos naming,
// final-day knockout eligibility, and Go Live minimums were each decided by
// their own independently-written conditional scattered across build.tsx,
// draw.tsx and tour/index.tsx (three different membership lists that had
// already drifted apart — see project memory). One tournament format
// selection now flows through a single table: Available Rules ->
// Terminology -> Scoring Options -> Game Generation Rules -> Leaderboard
// Behaviour -> Validation, all read from here.
export type FormatId = 'team_matchplay' | 'titan_way' | 'ryder_cup' | 'stableford' | 'medal' | 'knockout';

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
  minPlayers: number | null;             // Go Live validation
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
    minPlayers: null,
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
    sub: '4BBB Stableford opening rounds build a team league, then a final-day knockout + singles draw — plus a full Kronos individual championship. Minimum 4 teams, 16 players.',
    available: true,
    isTeamFormat: true,
    individualBoardDefaultOn: true,
    individualBoardLabel: 'Kronos',
    captainRotation: true,
    finalDayKnockout: true,
    lastDaySinglesOverride: true,
    minTeams: 4,
    minPlayers: 16,
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
    minPlayers: null,
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
    minPlayers: null,
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
    minPlayers: null,
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
    minPlayers: null,
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
