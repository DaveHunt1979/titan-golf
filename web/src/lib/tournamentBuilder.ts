// Round-level (per-day) builder types and helpers, mirroring the mobile
// Tournament Builder (app/(app)/admin/build.tsx) so a tournament created on
// the web writes byte-identical rows to one created in the app.

import { createClient } from '@/lib/supabase/client';
import type { FormatRules } from '@/lib/tournamentFormat';

// Only formats that actually have a working Casual Round scoring engine
// behind them. Foursomes/Greensomes/Scramble used to be offered here on the
// web (and only here — mobile dropped them) but never got real scoring
// support in the app's score-entry screen, so a web-created tournament could
// name a round format the app cannot score.
export type DayFormatId =
  | 'four_bbb'
  | 'four_bbb_stroke'
  | 'singles'
  | 'singles_stableford'
  | 'stableford'
  | 'medal';

export const DAY_FORMATS: Array<{ id: DayFormatId; label: string; sub: string; teamOnly: boolean }> = [
  { id: 'four_bbb',           label: '4BBB Match Play – Stableford',     sub: 'Best ball pairs',                 teamOnly: true  },
  { id: 'four_bbb_stroke',    label: '4BBB Match Play – Stroke Play',    sub: 'Best ball, relative handicap',    teamOnly: true  },
  { id: 'singles',            label: 'Singles Match Play – Stroke Play', sub: '1v1 matchplay, net strokes',      teamOnly: false },
  { id: 'singles_stableford', label: 'Singles Match Play – Stableford',  sub: '1v1 matchplay, points per hole',  teamOnly: false },
  { id: 'stableford',         label: 'Stableford',                       sub: 'Points per hole',                 teamOnly: false },
  { id: 'medal',              label: 'Medal',                            sub: 'Stroke play',                     teamOnly: false },
];

export const HCP_OPTIONS = [
  { pct: 100, label: '100%' },
  { pct: 95,  label: '95%'  },
  { pct: 90,  label: '90%'  },
  { pct: 85,  label: '85%'  },
  { pct: 75,  label: '75%'  },
  { pct: 0,   label: 'Scratch' },
];

export interface DayConfig {
  courseName: string;
  // Slope/course rating are what every WHS course-handicap conversion reads;
  // leaving them blank silently forces the "no rating available" fallback.
  slopeRating: string;
  courseRating: string;
  // One tee box per round, chosen once by the organiser and played by every
  // enrolled player in that round. gender is stored alongside the name
  // because course_tees is keyed by (course_name, tee_name, gender) and the
  // M/F rows of the same colour carry different course/slope ratings.
  teeName: string;
  teeGender: string;
  whsEnabled: boolean;
  teeTime: string;   // 'HH:MM'
  playDate: string;  // ISO 'YYYY-MM-DD' — the web uses a native date input, so no UK-string conversion is needed
  format: DayFormatId;
  hcpPct: number;
  ldEnabled: boolean;
  ldHole: number | null;
  ntpEnabled: boolean;
  ntpHole: number | null;
}

export function blankDay(format: DayFormatId, hcpPct: number): DayConfig {
  return {
    courseName: '', slopeRating: '', courseRating: '',
    teeName: '', teeGender: '', whsEnabled: false,
    teeTime: '', playDate: '',
    format, hcpPct,
    ldEnabled: false, ldHole: null,
    ntpEnabled: false, ntpHole: null,
  };
}

// Applies a format's last-day override (e.g. Titan Way: final round forced to
// Singles @ 85%) to whatever is CURRENTLY the last day — called from format
// pick, add-round and remove-round alike, so the override always tracks the
// real final round instead of freezing at format-pick time. An already-chosen
// Singles variant (Stroke Play vs Stableford) is preserved rather than being
// silently reverted.
export function applyLastDayOverride(days: DayConfig[], rules: FormatRules): DayConfig[] {
  if (!rules.lastDaySinglesOverride || days.length === 0) return days;
  return days.map((d, i) => {
    if (i !== days.length - 1) return d;
    const format: DayFormatId = d.format === 'singles' || d.format === 'singles_stableford' ? d.format : 'singles';
    return { ...d, format, hcpPct: 85 };
  });
}

// ── Tees ──────────────────────────────────────────────────────────────────────

export interface SelectableTee {
  tee_name: string;
  gender: string; // 'M' | 'F' | ''
  par: number | null;
  course_rating: number | null;
  slope_rating: number | null;
}

// Same single shared query every round-setup screen uses — course_tees is
// additive reference data from the course-master import, never guessed at.
export async function fetchCourseTees(courseName: string): Promise<SelectableTee[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('course_tees')
    .select('tee_name, gender, par, course_rating, slope_rating')
    .eq('course_name', courseName)
    .order('tee_name');
  return (data as SelectableTee[] | null) ?? [];
}

export async function fetchTeesForRounds(relevantDays: DayConfig[]): Promise<Record<string, SelectableTee[]>> {
  const byCourse: Record<string, SelectableTee[]> = {};
  for (const d of relevantDays) {
    if (!d.courseName || byCourse[d.courseName]) continue;
    byCourse[d.courseName] = await fetchCourseTees(d.courseName);
  }
  return byCourse;
}

// One tee per round for everyone — no per-player branch. Matches on tee name
// alone when no gender was recorded, preferring a fully rated row so the WHS
// numbers are usable.
export function resolveTeeForRound(courseTees: SelectableTee[], day: DayConfig): SelectableTee | undefined {
  const teeName = day.teeName.trim();
  if (!teeName) return undefined;
  const sameName = courseTees.filter(t => t.tee_name === teeName);
  const exact = sameName.find(t => (t.gender ?? '') === (day.teeGender ?? ''));
  if (exact) return exact;
  if (day.teeGender) return undefined;
  return sameName.find(t => t.par != null && t.course_rating != null && t.slope_rating != null) ?? sameName[0];
}

export function teeLabel(t: SelectableTee): string {
  return t.gender ? `${t.tee_name} (${t.gender})` : t.tee_name;
}

// ── WHS ───────────────────────────────────────────────────────────────────────

export interface WHSHandicapResult { courseHandicapUnrounded: number; playingHandicap: number; }

export function calculateWHSPlayingHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number,
  handicapAllowancePct: number,
): WHSHandicapResult {
  const courseHandicapUnrounded = handicapIndex * (slopeRating / 113) + (courseRating - par);
  const playingHandicap = Math.round(courseHandicapUnrounded * (handicapAllowancePct / 100));
  return { courseHandicapUnrounded, playingHandicap };
}

// ── Automatic Tournament Handicap Cuts ────────────────────────────────────────

export interface HandicapCutBand { min: number; max: number | null; cutPerPoint: number; }

export const DEFAULT_HANDICAP_CUT_BANDS: HandicapCutBand[] = [
  { min: 0,  max: 9.9,  cutPerPoint: 0.5 },
  { min: 10, max: 18.9, cutPerPoint: 1.0 },
  { min: 19, max: 28.9, cutPerPoint: 2.0 },
  { min: 29, max: null, cutPerPoint: 2.0 },
];

// ── Info Pack ─────────────────────────────────────────────────────────────────

// The mobile Info Pack editor (app/(app)/admin/info.tsx) writes a rich,
// eight-card structure into competitions.info_pack. The web builder writes a
// deliberately narrower subset of the SAME jsonb column so the two never
// fight: only these four free-text keys are touched, and everything else the
// mobile editor may have already stored is merged through untouched.
export interface WebInfoPack {
  schedule: string;
  travel: string;
  rules: string;
  contacts: string;
}

export function emptyWebInfoPack(): WebInfoPack {
  return { schedule: '', travel: '', rules: '', contacts: '' };
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export function genPin(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// PostgREST caps an unbounded select at 1000 rows, and the course master is
// well past that (1,241+ courses) — an unpaginated read silently drops every
// course past row 1000 out of the picker entirely.
export async function fetchAllRows<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await run(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
