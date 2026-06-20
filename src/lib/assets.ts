export const titanLogo = require('../../assets/TitanAppLogo.png');

export const hosts = {
  birdie:     require('../../assets/hosts/Birdie_McGreen.jpg'),
  chip:       require('../../assets/hosts/Chip_Fairway.jpg'),
  birdieBody: require('../../assets/hosts/birdie_splash.png'),
  chipBody:   require('../../assets/hosts/chip_splash.png'),
};

export const teamLogos: Record<string, any> = {
  'MOB':         require('../../assets/teams/The Mob.png'),
  'Destroyers':  require('../../assets/teams/Destroyers.png'),
  'Legion Six':  require('../../assets/teams/Legion Six.png'),
  'Renegades':   require('../../assets/teams/Renegades.png'),
  'Elite':       require('../../assets/teams/Rlite.png'),
  'Instigators': require('../../assets/teams/The Instigators.png'),
};

export const playerAvatars: Record<string, { normal: any; happy: any; angry: any }> = {
  '20000000-0000-0000-0000-000000000001': { normal: require('../../assets/players/01_normal.png'), happy: require('../../assets/players/01_happy.png'), angry: require('../../assets/players/01_angry.png') },
  '20000000-0000-0000-0000-000000000002': { normal: require('../../assets/players/02_normal.png'), happy: require('../../assets/players/02_happy.png'), angry: require('../../assets/players/02_angry.png') },
  '20000000-0000-0000-0000-000000000003': { normal: require('../../assets/players/03_normal.png'), happy: require('../../assets/players/03_happy.png'), angry: require('../../assets/players/03_angry.png') },
  '20000000-0000-0000-0000-000000000004': { normal: require('../../assets/players/04_normal.png'), happy: require('../../assets/players/04_happy.png'), angry: require('../../assets/players/04_angry.png') },
  '20000000-0000-0000-0000-000000000005': { normal: require('../../assets/players/05_normal.png'), happy: require('../../assets/players/05_happy.png'), angry: require('../../assets/players/05_angry.png') },
  '20000000-0000-0000-0000-000000000006': { normal: require('../../assets/players/06_normal.png'), happy: require('../../assets/players/06_happy.png'), angry: require('../../assets/players/06_angry.png') },
  '20000000-0000-0000-0000-000000000007': { normal: require('../../assets/players/07_normal.png'), happy: require('../../assets/players/07_happy.png'), angry: require('../../assets/players/07_angry.png') },
  '20000000-0000-0000-0000-000000000008': { normal: require('../../assets/players/08_normal.png'), happy: require('../../assets/players/08_happy.png'), angry: require('../../assets/players/08_angry.png') },
  '20000000-0000-0000-0000-000000000009': { normal: require('../../assets/players/09_normal.png'), happy: require('../../assets/players/09_happy.png'), angry: require('../../assets/players/09_angry.png') },
  '20000000-0000-0000-0000-000000000010': { normal: require('../../assets/players/10_normal.png'), happy: require('../../assets/players/10_happy.png'), angry: require('../../assets/players/10_angry.png') },
  '20000000-0000-0000-0000-000000000011': { normal: require('../../assets/players/11_normal.png'), happy: require('../../assets/players/11_happy.png'), angry: require('../../assets/players/11_angry.png') },
  '20000000-0000-0000-0000-000000000012': { normal: require('../../assets/players/12_normal.png'), happy: require('../../assets/players/12_happy.png'), angry: require('../../assets/players/12_angry.png') },
  '20000000-0000-0000-0000-000000000013': { normal: require('../../assets/players/13_normal.png'), happy: require('../../assets/players/13_happy.png'), angry: require('../../assets/players/13_angry.png') },
  '20000000-0000-0000-0000-000000000014': { normal: require('../../assets/players/14_normal.png'), happy: require('../../assets/players/14_happy.png'), angry: require('../../assets/players/14_angry.png') },
  '20000000-0000-0000-0000-000000000015': { normal: require('../../assets/players/15_normal.png'), happy: require('../../assets/players/15_happy.png'), angry: require('../../assets/players/15_angry.png') },
  '20000000-0000-0000-0000-000000000016': { normal: require('../../assets/players/16_normal.png'), happy: require('../../assets/players/16_happy.png'), angry: require('../../assets/players/16_angry.png') },
  '20000000-0000-0000-0000-000000000017': { normal: require('../../assets/players/17_normal.png'), happy: require('../../assets/players/17_happy.png'), angry: require('../../assets/players/17_angry.png') },
  '20000000-0000-0000-0000-000000000018': { normal: require('../../assets/players/18_normal.png'), happy: require('../../assets/players/18_happy.png'), angry: require('../../assets/players/18_angry.png') },
  '20000000-0000-0000-0000-000000000019': { normal: require('../../assets/players/19_normal.png'), happy: require('../../assets/players/19_happy.png'), angry: require('../../assets/players/19_angry.png') },
  '20000000-0000-0000-0000-000000000020': { normal: require('../../assets/players/20_normal.png'), happy: require('../../assets/players/20_happy.png'), angry: require('../../assets/players/20_angry.png') },
  '20000000-0000-0000-0000-000000000021': { normal: require('../../assets/players/21_normal.png'), happy: require('../../assets/players/21_happy.png'), angry: require('../../assets/players/21_angry.png') },
  '20000000-0000-0000-0000-000000000022': { normal: require('../../assets/players/22_normal.png'), happy: require('../../assets/players/22_happy.png'), angry: require('../../assets/players/22_angry.png') },
  '20000000-0000-0000-0000-000000000023': { normal: require('../../assets/players/23_normal.png'), happy: require('../../assets/players/23_happy.png'), angry: require('../../assets/players/23_angry.png') },
  '20000000-0000-0000-0000-000000000024': { normal: require('../../assets/players/24_normal.png'), happy: require('../../assets/players/24_happy.png'), angry: require('../../assets/players/24_angry.png') },
};

export function getPlayerAvatar(playerId: string, mood: 'normal' | 'happy' | 'angry' = 'normal') {
  return playerAvatars[playerId]?.[mood] ?? null;
}
