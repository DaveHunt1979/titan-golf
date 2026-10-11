import { matchplayHcp, type MatchForScoring } from './matchScoring';
import { calcStrokesReceived, calcStablefordPoints } from './scoring';

// Ricky/Harry report 2026-10-10: Match Play–Stableford grid showed the stored
// 100%-handicap pts instead of the match's own (85%, relative-low) points.
const match: MatchForScoring = {
  id: 'm', round_format: 'matchplay', handicap_method: 'relative_low_stableford',
  secondary_format: null, hcp_allowance: 85,
  home_player_ids: ['ricky', 'mike'], away_player_ids: ['arron', 'ross'],
  status: 'complete', winner: 'home', result_str: null, started_at: null, completed_at: null,
  day: null,
};
const comp = [
  { player_id: 'ricky', handicap_index: 26 }, { player_id: 'mike', handicap_index: 12 },
  { player_id: 'arron', handicap_index: 18 }, { player_id: 'ross', handicap_index: 14 },
];
const all = ['ricky', 'mike', 'arron', 'ross'];

describe('matchplayHcp relative_low_stableford', () => {
  it('plays everyone off the group low at the match allowance', () => {
    // 85%: ricky 22, mike 10, arron 15, ross 12 -> low is 10
    expect(matchplayHcp('mike', match, comp, {}, all)).toBe(0);
    expect(matchplayHcp('ricky', match, comp, {}, all)).toBe(12);
  });

  it('gives fewer points than the stored 100% value on a shot hole', () => {
    const shots85 = calcStrokesReceived(matchplayHcp('ricky', match, comp, {}, all), 6);
    const shots100 = calcStrokesReceived(26, 6);
    expect(shots85).toBe(1);  // 12 off the low man: one shot on SI 6
    expect(shots100).toBe(2); // full 26: two shots on SI 6
    expect(calcStablefordPoints(5, 4, shots85)).toBeLessThan(calcStablefordPoints(5, 4, shots100));
  });
});
