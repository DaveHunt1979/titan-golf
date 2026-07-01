import { supabase } from './supabase';

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
): Promise<BrokenRecord[]> {
  // Get player info + society
  const [playerRes, memberRes] = await Promise.all([
    supabase.from('players').select('display_name').eq('id', playerId).maybeSingle(),
    supabase.from('society_members').select('society_id').eq('player_id', playerId).limit(1).maybeSingle(),
  ]);

  if (!memberRes.data) return [];
  const societyId  = (memberRes.data as any).society_id as string;
  const playerName = (playerRes.data as any)?.display_name ?? 'Unknown';

  // Get hole data for this round
  const [holesRes, matchRes] = await Promise.all([
    supabase
      .from('match_holes')
      .select('gross_score, stableford_pts')
      .eq('match_id', matchId)
      .eq('player_id', playerId),
    supabase
      .from('matches')
      .select('day:day_id(course_name)')
      .eq('id', matchId)
      .maybeSingle(),
  ]);

  const holes = (holesRes.data ?? []) as any[];
  const holesWithScore = holes.filter(h => h.gross_score != null);

  // Only check records on complete 18-hole rounds
  if (holesWithScore.length < 18) return [];

  const grossTotal      = holesWithScore.reduce((s: number, h: any) => s + h.gross_score, 0);
  const stablefordTotal = holes.reduce((s: number, h: any) => s + (h.stableford_pts ?? 0), 0);
  const birdieCount     = holes.filter((h: any) => (h.stableford_pts ?? 0) === 3).length;
  const eagleCount      = holes.filter((h: any) => (h.stableford_pts ?? 0) >= 4).length;
  const courseName      = (matchRes.data as any)?.day?.course_name ?? '';

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
