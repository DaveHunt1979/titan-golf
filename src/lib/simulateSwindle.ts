// In-app Swindle simulator — same idea as simulateTournament.ts, scaled to
// Swindle's actual (much simpler) shape: entrants + one scored round, no
// teams. Authenticated client only, real RLS, no service-role key.
import { supabase } from './supabase';
import { calcStrokesReceived, calcStablefordPoints, playerCourseHcp } from './scoring';

export interface SimulateSwindleOptions {
  societyId: string;
  entrantCount: number; // 4-100
  format: 'stableford' | 'stroke';
  onProgress?: (msg: string) => void;
}

export interface SimulateSwindleResult {
  gameId: string;
  gameName: string;
  winnerName: string;
  winnerScore: string;
  syntheticPlayerCount: number;
}

function rnd(seed: { v: number }) {
  seed.v |= 0; seed.v = (seed.v + 0x6D2B79F5) | 0;
  let t = Math.imul(seed.v ^ (seed.v >>> 15), 1 | seed.v);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

async function insertAll<T>(table: string, rows: any[], chunkSize = 400): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { data, error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize)).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
  }
  return out;
}

export async function runSwindleSimulation(opts: SimulateSwindleOptions): Promise<SimulateSwindleResult> {
  const { societyId, entrantCount, format, onProgress } = opts;
  if (entrantCount < 2 || entrantCount > 100) throw new Error('Pick between 2 and 100 entrants.');

  onProgress?.('Checking course data...');
  const { data: candidateCourses } = await supabase.from('courses').select('name').limit(30);
  let course: { name: string; rating: number; slope: number; holes: any[] } | null = null;
  for (const c of (candidateCourses ?? []) as any[]) {
    const { data: holes } = await supabase.from('course_holes').select('hole_number,par,stroke_index')
      .eq('course_name', c.name).order('hole_number');
    if (!holes || holes.length !== 18) continue;
    const parSum = holes.reduce((s, h: any) => s + h.par, 0);
    if (new Set(holes.map((h: any) => h.stroke_index)).size !== 18 || parSum < 68 || parSum > 74) continue;
    const { data: tees } = await supabase.from('course_tees').select('course_rating,slope_rating').eq('course_name', c.name).limit(1);
    const tee = (tees ?? [])[0];
    if (!tee?.course_rating || !tee?.slope_rating) continue;
    course = { name: c.name, rating: tee.course_rating, slope: tee.slope_rating, holes };
    break;
  }
  if (!course) throw new Error('No course found with clean 18-hole par/SI + rating data to simulate against.');

  onProgress?.('Building entrant list...');
  const { data: smRows } = await supabase.from('society_members').select('player_id').eq('society_id', societyId);
  const realIds = [...new Set((smRows ?? []).map((r: any) => r.player_id))];
  const { data: realPlayers } = realIds.length
    ? await supabase.from('players').select('id,display_name,handicap_index').in('id', realIds)
    : { data: [] as any[] };
  const pool = (realPlayers ?? []).map((p: any) => ({ id: p.id, display_name: p.display_name, handicap_index: p.handicap_index ?? 14 }));
  const shortfall = entrantCount - pool.length;
  if (shortfall > 0) {
    onProgress?.(`Creating ${shortfall} synthetic entrants (society only has ${pool.length})...`);
    const rows = Array.from({ length: shortfall }, (_, i) => ({
      display_name: `Sim Player ${pool.length + i + 1}`,
      handicap_index: [4, 8, 12, 14, 16, 18, 20, 24][i % 8],
    }));
    const created = await insertAll<any>('players', rows);
    pool.push(...created.map((p: any) => ({ id: p.id, display_name: p.display_name, handicap_index: p.handicap_index })));
  }
  const entrants = pool.slice(0, entrantCount);

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user ? await supabase.from('players').select('id').eq('auth_uid', user.id).maybeSingle() : { data: null as any };
  if (!me) throw new Error('Could not resolve the current admin as a player.');

  onProgress?.('Creating game...');
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const [game] = await insertAll<any>('swindle_games', [{
    name: `Simulation — ${format === 'stroke' ? 'Stroke Play' : 'Stableford'} — ${entrantCount} players — ${new Date().toLocaleDateString('en-GB')}`,
    course_name: course.name, entry_fee: 5, currency: '£', prize_split: [50, 30, 20],
    join_code: code, status: 'in_progress', created_by: me.id, society_id: societyId,
    game_date: new Date().toISOString().split('T')[0], format, hcp_allowance: 100,
    slope_rating: course.slope, course_rating: course.rating, whs_enabled: false,
    is_simulation: true,
  }]);

  onProgress?.('Entering players...');
  await insertAll('swindle_entries', entrants.map(p => ({ game_id: game.id, player_id: p.id, handicap: p.handicap_index })));

  onProgress?.('Simulating scores...');
  const seed = { v: Date.now() & 0xffffffff };
  const stablefordTotals: Record<string, number> = {};
  const grossTotals: Record<string, number> = {};
  const scoreRows: any[] = [];
  for (const p of entrants) {
    const courseHcp = playerCourseHcp(p.handicap_index, { slope_rating: course.slope, course_rating: course.rating, course_par: course.holes.reduce((s, h) => s + h.par, 0) }, 100);
    for (const h of course.holes) {
      const shots = calcStrokesReceived(courseHcp, h.stroke_index);
      const table = [-2, -1, -1, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
      const gross = Math.max(1, h.par + table[Math.floor(rnd(seed) * table.length)]);
      const pts = calcStablefordPoints(gross, h.par, shots);
      stablefordTotals[p.id] = (stablefordTotals[p.id] ?? 0) + pts;
      grossTotals[p.id] = (grossTotals[p.id] ?? 0) + gross;
      scoreRows.push({ game_id: game.id, player_id: p.id, hole_number: h.hole_number, gross_score: gross, stableford_pts: pts });
    }
  }
  await insertAll('swindle_scores', scoreRows);
  await supabase.from('swindle_games').update({ status: 'complete' }).eq('id', game.id);

  // Same sort key the real game screen uses per format (swindle/[gameId].tsx):
  // stroke play ranks by lowest total gross ascending, Stableford by highest
  // points descending.
  const sorted = format === 'stroke'
    ? Object.entries(grossTotals).sort((a, b) => a[1] - b[1])
    : Object.entries(stablefordTotals).sort((a, b) => b[1] - a[1]);
  const nameById: Record<string, string> = {};
  entrants.forEach(p => { nameById[p.id] = p.display_name; });

  return {
    gameId: game.id,
    gameName: game.name,
    winnerName: sorted[0] ? nameById[sorted[0][0]] : '—',
    winnerScore: sorted[0] ? (format === 'stroke' ? `${sorted[0][1]} gross` : `${sorted[0][1]} pts`) : '—',
    syntheticPlayerCount: entrants.filter(p => p.display_name.startsWith('Sim Player')).length,
  };
}

export async function deleteSwindleSimulation(gameId: string) {
  const { error } = await supabase.from('swindle_games').delete().eq('id', gameId).eq('is_simulation', true);
  if (error) throw error;
}
