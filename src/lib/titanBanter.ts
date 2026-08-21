// Chip & Birdie banter — scene images and character portraits for Titan
// News (Dave, 2026-08-21). Scene images are a small FIXED set Dave supplies
// himself (never AI-generated per report — see project memory on why),
// keyed by the same scene names the titan-news edge function's prompt
// picks from. Add the real files to assets/hosts/scenes/ as Dave delivers
// them; until then this gracefully falls back to just the speaker's
// portrait, no scene image.
export const CHIP_PORTRAIT   = require('../../assets/hosts/chip_full.png');
export const BIRDIE_PORTRAIT = require('../../assets/hosts/birdie_full.png');

export type BanterSpeaker = 'chip' | 'birdie';

// Static require() map, not a dynamic path — Metro can't resolve
// require(`...${variable}...`), every asset must be a literal call site.
const SCENE_IMAGES: Record<string, any> = {
  // 'bunker':    require('../../assets/hosts/scenes/bunker.png'),
  // 'trees':     require('../../assets/hosts/scenes/trees.png'),
  // 'water':     require('../../assets/hosts/scenes/water.png'),
  // 'leaderboard': require('../../assets/hosts/scenes/leaderboard.png'),
  // 'trophy':    require('../../assets/hosts/scenes/trophy.png'),
  // 'clubhouse': require('../../assets/hosts/scenes/clubhouse.png'),
  // 'sunset':    require('../../assets/hosts/scenes/sunset.png'),
  // 'storm':     require('../../assets/hosts/scenes/storm.png'),
};

export function speakerName(speaker: BanterSpeaker): string {
  return speaker === 'chip' ? 'Chip' : 'Birdie';
}

export function speakerPortrait(speaker: BanterSpeaker) {
  return speaker === 'chip' ? CHIP_PORTRAIT : BIRDIE_PORTRAIT;
}

export function sceneImage(scene: string | null): any | null {
  return scene ? SCENE_IMAGES[scene] ?? null : null;
}
