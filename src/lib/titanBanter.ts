// Chip & Birdie banter — scene images and character portraits for Titan
// News (Dave, 2026-08-21). Scene images are a small FIXED set Dave supplies
// himself (never AI-generated per report — see project memory on why),
// keyed by the same scene names the titan-news edge function's prompt
// picks from. Add the real files to assets/hosts/scenes/ as Dave delivers
// them; until then this gracefully falls back to just the speaker's
// portrait, no scene image.
// Headshot crops, not the full-body renders — RN Image defaults to
// centering a 'cover' resize, which on a tall full-body image lands on the
// waist/legs, not the face (Dave, 2026-08-21: "I only [see] chips legs in
// this little circle image").
export const CHIP_PORTRAIT   = require('../../assets/hosts/chip_headshot.png');
export const BIRDIE_PORTRAIT = require('../../assets/hosts/birdie_headshot.png');

export type BanterSpeaker = 'chip' | 'birdie';

// Static require() map, not a dynamic path — Metro can't resolve
// require(`...${variable}...`), every asset must be a literal call site.
// Keep this key list in sync with the edge function's BANTER_SCENES
// (supabase/functions/titan-news/index.ts) and the web Newsreel page's
// equivalent map — three separate copies by necessity, same debt already
// accepted for scoring color maps elsewhere.
const SCENE_IMAGES: Record<string, any> = {
  'golf-cart':      require('../../assets/hosts/scenes/golf-cart.png'),
  'hiding-tree':    require('../../assets/hosts/scenes/hiding-tree.png'),
  'bunker':         require('../../assets/hosts/scenes/bunker.png'),
  'celebration':    require('../../assets/hosts/scenes/celebration.png'),
  'sunset-view':    require('../../assets/hosts/scenes/sunset-view.png'),
  'broadcast-desk': require('../../assets/hosts/scenes/broadcast-desk.png'),
  'hiding-bushes':  require('../../assets/hosts/scenes/hiding-bushes.png'),
  'giant-bunker':   require('../../assets/hosts/scenes/giant-bunker.png'),
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
