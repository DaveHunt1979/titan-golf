import { supabase } from './supabase';
import { countScoreBreakdown } from './scoring';

export type RecordType =
  | 'best_gross_18'
  | 'best_stableford_18'
  | 'most_birdies_round'
  | 'most_eagles_round';

export interface BrokenRecord {
  type: RecordType;
  label: string;
  icon: string;
  newValue: number;
  oldValue: number | null;
  unit: string;
  prevHolder: string | null;
}

const RECORD_META: Record<RecordType, { label: string; icon: string; unit: string; better: 'lower' | 'higher' }> = {
  best_gross_18:      { label: 'Best Gross Round',          icon: '🏌️', unit: 'strokes', better: 'lower'  },
  best_stableford_18: { label: 'Best Stableford Round',     icon: '⭐',  unit: 'pts',    better: 'higher' },
  most_birdies_round: { label: 'Most Birdies in a Round',   icon: '🐦',  unit: 'birdies',better: 'higher' },
  most_eagles_round:  { label: 'Most Eagles in a Round',    icon: '🦅',  unit: 'eagles', better: 'higher' },
};

function isBetter(type: RecordType, newVal: number, oldVal: number): boolean {
  return RECORD_META[type].better === 'lower' ? newVal < oldVal : newVal > oldVal;
}

export async function checkAndUpdateRecords(
  matchId: string,
  playerId: string,
  // The Locker Room-active society the round was actually scored in — the
  // caller already has this from useSocietyTheme(). A tournament round's own
  // competition.society_id (set once, at creation, authoritative regardless
  // of who's viewing) wins when there is one; this is only the fallback for
  // casual rounds, which carry no competition/society link of their own at
  // all. Never fall back to an arbitrary row off the player's own
  // society_members — a real multi-society player (an admin of two clubs,
  // e.g.) has no single "true" membership row, so that lookup was
  // attributing records to whichever society happened to sort first for
  // them, not the one the round was played in (Ricky, 2026-09-14 — his own
  // best-round records were landing under Skullers' Wall of Records purely
  // because that membership row outsorted his Titan one, not because he'd
  // played for Skullers).
  fallbackSocietyId: string | null,
): Promise<BrokenRecord[]> {
  const [playerRes, holesRes, matchRes] = await Promise.all([
    supabase.from('players').select('display_name, is_guest').eq('id', playerId).maybeSingle(),
    supabase
      .from('match_holes')
      .select('hole_number, gross_score, stableford_pts')
      .eq('match_id', matchId)
      .eq('player_id', playerId),
    supabase
      .from('matches')
      .select('day:day_id(course_name, competition:competition_id(society_id))')
      .eq('id', matchId)
      .maybeSingle(),
  ]);

  // Every other membership-scoped surface excludes guests for free by way of
  // them having no society_members row — this one doesn't, because it takes a
  // raw playerId and writes straight to society_records. A guest's round must
  // never land on the Wall of Records (Rick, 2026-09-15).
  if ((playerRes.data as any)?.is_guest) return [];

  const societyId = ((matchRes.data as any)?.day?.competition?.society_id as string | undefined) ?? fallbackSocietyId ?? undefined;
  if (!societyId) return [];
  const playerName = (playerRes.data as any)?.display_name ?? 'Unknown';

  const holes = (holesRes.data ?? []) as any[];
  const holesWithScore = holes.filter(h => h.gross_score != null);

  // Only check records on complete 18-hole rounds
  if (holesWithScore.length < 18) return [];

  const courseName = (matchRes.data as any)?.day?.course_name ?? '';
  const { data: courseHolesData } = courseName
    ? await supabase.from('course_holes').select('hole_number, par').eq('course_name', courseName)
    : { data: [] as any[] };

  const grossTotal      = holesWithScore.reduce((s: number, h: any) => s + h.gross_score, 0);
  const stablefordTotal = holes.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0);
  // Gross-vs-par, never Stableford points (Rick's brief, section 10) — a
  // points-based counter here previously wrote inflated birdie/eagle counts
  // straight into this shared, other-members-visible records table.
  const breakdown       = countScoreBreakdown(holesWithScore, (courseHolesData ?? []) as any[]);
  const birdieCount     = breakdown.birdie;
  const eagleCount      = breakdown.eagle;

  // Load existing society records
  const { data: existing } = await supabase
    .from('society_records')
    .select('*')
    .eq('society_id', societyId);

  const recordMap: Record<string, any> = {};
  for (const r of (existing ?? [])) recordMap[r.record_type] = r;

  const candidates: Array<{ type: RecordType; value: number }> = [
    { type: 'best_gross_18',      value: grossTotal      },
    { type: 'best_stableford_18', value: stablefordTotal },
    { type: 'most_birdies_round', value: birdieCount     },
    { type: 'most_eagles_round',  value: eagleCount      },
  ];

  const broken: BrokenRecord[] = [];
  const now = new Date().toISOString();

  for (const c of candidates) {
    // Don't crown a record of 0 eagles/birdies
    if ((c.type === 'most_eagles_round' || c.type === 'most_birdies_round') && c.value === 0) continue;

    const curr = recordMap[c.type];
    if (curr && !isBetter(c.type, c.value, Number(curr.value))) continue;

    const prevHolder = curr?.player_name ?? null;
    const oldValue   = curr ? Number(curr.value) : null;

    await supabase.from('society_records').upsert(
      {
        society_id:  societyId,
        record_type: c.type,
        player_id:   playerId,
        player_name: playerName,
        value:       c.value,
        match_id:    matchId,
        course_name: courseName,
        achieved_at: now,
      },
      { onConflict: 'society_id,record_type' },
    );

    broken.push({
      type:        c.type,
      label:       RECORD_META[c.type].label,
      icon:        RECORD_META[c.type].icon,
      unit:        RECORD_META[c.type].unit,
      newValue:    c.value,
      oldValue,
      prevHolder,
    });
  }

  return broken;
}
