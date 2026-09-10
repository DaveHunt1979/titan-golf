import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { colors } from './theme';
import { getSocietyLogo } from './assets';

const societyKey = (uid: string) => `active_society_id:${uid}`;
const LIGHT_MODE_KEY = 'titan:light_mode';
const GOLD = '#D4AF37';

// ── Colour helpers ────────────────────────────────────────────────
export interface ThemePalette {
  bg:            string;
  card:          string;
  border:        string;
  goldBorder:    string;
  accent:        string;
  text:          string;
  textSecondary: string;
  textMuted:     string;
  cardText:      string;
  iconBoxBg:     string;
  iconBoxBorder: string;
  iconBoxIcon:   string;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function lightenHex(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// For dark-primary societies: lighten uniformly but always boost blue so the
// card reads as navy rather than grey (handles even pure-black primaries).
function navyCard(hex: string): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.slice(0, 2), 16) + 46);
  const g = Math.min(255, parseInt(h.slice(2, 4), 16) + 46);
  const b = Math.min(255, parseInt(h.slice(4, 6), 16) + 110);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Dark palettes (default) ───────────────────────────────────────
export const TITAN_PALETTE: ThemePalette = {
  bg:            colors.bg,
  card:          colors.card,
  border:        colors.border,
  goldBorder:    colors.goldBorder,
  accent:        colors.gold,
  text:          colors.white,
  textSecondary: colors.textSecondary,
  textMuted:     colors.textMuted,
  cardText:      colors.white,
  iconBoxBg:     'rgba(212,175,55,0.08)',
  iconBoxBorder: 'rgba(212,175,55,0.25)',
  iconBoxIcon:   colors.gold,
};

export function derivePalette(primaryColor: string, secondaryColor: string): ThemePalette {
  if (primaryColor.toLowerCase() === GOLD.toLowerCase()) {
    // "Titan" preset — gold has always been the un-customised default
    // colour, so a society sitting on exactly this hex (e.g. one that
    // never picked a colour) gets Titan's real classic black/gold look,
    // not a hue-derived variant of gold.
    return TITAN_PALETTE;
  }
  if (hexLuminance(primaryColor) < 0.15) {
    // Dark primary = brand background (e.g. Mashie #000035 navy)
    const accent = secondaryColor || '#ffffff';
    return {
      bg:            primaryColor,
      card:          navyCard(primaryColor),
      border:        'rgba(255,255,255,0.18)',
      goldBorder:    'rgba(255,255,255,0.35)',
      accent,
      text:          '#ffffff',
      textSecondary: 'rgba(255,255,255,0.68)',
      textMuted:     'rgba(255,255,255,0.38)',
      cardText:      '#ffffff',
      iconBoxBg:     primaryColor,
      iconBoxBorder: 'rgba(255,255,255,0.65)',
      iconBoxIcon:   '#ffffff',
    };
  }
  // Light/vibrant primary (e.g. a society picks green): derive a dark
  // background/card tinted with the same hue instead of falling back to
  // fixed Titan black, so the chosen colour actually reskins the app
  // rather than only tinting small accent details.
  const { h, s } = hexToHsl(primaryColor);
  const sat = Math.min(Math.max(s, 0.5), 0.9);
  const bg   = hslToHex(h, sat * 0.85, 0.10);
  const card = hslToHex(h, sat * 0.85, 0.18);
  const accent = secondaryColor || primaryColor;
  return {
    bg,
    card,
    border:        'rgba(255,255,255,0.14)',
    goldBorder:    'rgba(255,255,255,0.30)',
    accent,
    text:          '#ffffff',
    textSecondary: 'rgba(255,255,255,0.68)',
    textMuted:     'rgba(255,255,255,0.38)',
    cardText:      '#ffffff',
    iconBoxBg:     hexToRgba(primaryColor, 0.12),
    iconBoxBorder: hexToRgba(primaryColor, 0.30),
    iconBoxIcon:   primaryColor,
  };
}

// ── Light palettes ────────────────────────────────────────────────
export const TITAN_LIGHT_PALETTE: ThemePalette = {
  bg:            '#ffffff',
  card:          '#f0f0f0',
  border:        'rgba(0,0,0,0.10)',
  goldBorder:    'rgba(212,175,55,0.40)',
  accent:        GOLD,
  text:          '#000000',
  textSecondary: 'rgba(0,0,0,0.60)',
  textMuted:     'rgba(0,0,0,0.38)',
  cardText:      '#000000',
  iconBoxBg:     'rgba(212,175,55,0.10)',
  iconBoxBorder: 'rgba(212,175,55,0.30)',
  iconBoxIcon:   GOLD,
};

export function deriveLightPalette(primaryColor: string, _secondaryColor: string): ThemePalette {
  if (primaryColor.toLowerCase() === GOLD.toLowerCase()) {
    return TITAN_LIGHT_PALETTE;
  }
  if (hexLuminance(primaryColor) < 0.15) {
    // Dark-primary society (e.g. Mashie navy) — the primary becomes text in light mode
    return {
      bg:            '#ffffff',
      card:          '#f0f0f0',
      border:        'rgba(0,0,0,0.10)',
      goldBorder:    'rgba(212,175,55,0.40)',
      accent:        GOLD,
      text:          primaryColor,
      textSecondary: hexToRgba(primaryColor, 0.65),
      textMuted:     hexToRgba(primaryColor, 0.40),
      cardText:      primaryColor,
      iconBoxBg:     'rgba(212,175,55,0.10)',
      iconBoxBorder: 'rgba(212,175,55,0.30)',
      iconBoxIcon:   GOLD,
    };
  }
  // Light/vibrant primary: tint the white background faintly with the same
  // hue instead of always defaulting to plain white + gold.
  const { h, s } = hexToHsl(primaryColor);
  const sat = Math.min(Math.max(s, 0.35), 0.75);
  return {
    bg:            hslToHex(h, sat * 0.25, 0.97),
    card:          hslToHex(h, sat * 0.3,  0.93),
    border:        'rgba(0,0,0,0.10)',
    goldBorder:    hexToRgba(primaryColor, 0.40),
    accent:        primaryColor,
    text:          '#000000',
    textSecondary: 'rgba(0,0,0,0.60)',
    textMuted:     'rgba(0,0,0,0.38)',
    cardText:      '#000000',
    iconBoxBg:     hexToRgba(primaryColor, 0.10),
    iconBoxBorder: hexToRgba(primaryColor, 0.30),
    iconBoxIcon:   primaryColor,
  };
}

// ── Context types ─────────────────────────────────────────────────
export interface SocietyTheme {
  primaryColor:    string;
  secondaryColor:  string;
  logoUrl:         string | null;
  heroUrl:         string | null;
  localLogo:       any | null;
  societyName:     string;
  tagline:         string;
  societyId:       string;
  loaded:          boolean;
  palette:         ThemePalette;
  lightMode:       boolean;
  toggleLightMode: () => void;
  switchSociety:   (societyId: string) => Promise<void>;
}

const DEFAULT: SocietyTheme = {
  primaryColor:    colors.gold,
  secondaryColor:  '#1B3A5C',
  logoUrl:         null,
  heroUrl:         null,
  localLogo:       null,
  societyName:     'TITAN GOLF',
  tagline:         '',
  societyId:       '00000000-0000-0000-0000-000000000001',
  loaded:          false,
  palette:         TITAN_PALETTE,
  lightMode:       false,
  toggleLightMode: () => {},
  switchSociety:   async () => {},
};

const Ctx = createContext<SocietyTheme>(DEFAULT);

const SOCIETY_COLOR_DEFAULTS: Record<string, { primary: string; secondary: string }> = {
  'mashie golf': { primary: '#000035', secondary: '#ffffff' },
};

type BaseTheme = Omit<SocietyTheme, 'lightMode' | 'toggleLightMode' | 'switchSociety'>;

async function fetchTheme(): Promise<BaseTheme> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...DEFAULT, loaded: true };

  const { data: player } = await supabase
    .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
  if (!player) return { ...DEFAULT, loaded: true };

  const pid = (player as any).id;
  const KEY = societyKey(user.id);

  // Use cached society if the player is still a member of it
  let societyId: string | null = await AsyncStorage.getItem(KEY);
  if (societyId) {
    const { data: check } = await supabase
      .from('society_members').select('society_id')
      .eq('player_id', pid).eq('society_id', societyId).maybeSingle();
    if (!check) societyId = null;
  }

  // Fall back: fetch all memberships. A single non-default membership is an
  // unambiguous "home" (an admin's own branded society, e.g. Mashie) and
  // gets auto-picked same as before. Two or more non-default memberships
  // is ambiguous — picking whichever came back first silently landed
  // Ricky in a 1-member leftover test society instead of the real 31-member
  // Titan Tour, which is why his trip/tournament/chat activity went missing
  // for everyone else (see 2026-08-19 session). With test societies about
  // to become routine via Locker Room, don't guess: fall back to the
  // shared default and let the Locker Room switcher make the explicit call.
  if (!societyId) {
    const { data: members } = await supabase
      .from('society_members').select('society_id')
      .eq('player_id', pid);
    if (!members?.length) return { ...DEFAULT, loaded: true };
    const ids = members.map((m: any) => m.society_id);
    const nonDefaultIds = ids.filter((id: string) => id !== DEFAULT.societyId);
    societyId = nonDefaultIds.length === 1
      ? nonDefaultIds[0]
      : ids.includes(DEFAULT.societyId)
        ? DEFAULT.societyId
        : ids[0];
    await AsyncStorage.setItem(KEY, societyId!);
  }

  const { data: society } = await supabase
    .from('societies')
    .select('name,tagline,primary_color,secondary_color,logo_url,hero_url')
    .eq('id', societyId!)
    .single();

  if (!society) return { ...DEFAULT, societyId: societyId!, loaded: true };

  const s = society as any;
  const name        = s.name ?? 'TITAN GOLF';
  const societyDefs = SOCIETY_COLOR_DEFAULTS[name.toLowerCase()];
  // SOCIETY_COLOR_DEFAULTS take precedence over DB values — DB colours may
  // be stale/wrong for known societies (e.g. Mashie secondary was saved as Titan gold).
  const primaryColor   = societyDefs?.primary   ?? s.primary_color   ?? colors.gold;
  // '' (not a fixed navy default) so derivePalette can tell "no secondary
  // chosen" apart from an actual user-picked colour and fall back to the
  // primary colour itself as the accent.
  const secondaryColor = societyDefs?.secondary ?? s.secondary_color ?? '';
  // Keyed off the stable seeded ID, not the name — "Titan Golf" doesn't
  // exist as a society row (the real one is "Titan Tour", same UUID as
  // DEFAULT.societyId), and the name is editable via admin branding anyway.
  const isTitan = societyId === DEFAULT.societyId;

  return {
    primaryColor,
    secondaryColor,
    logoUrl:     s.logo_url ?? null,
    heroUrl:     s.hero_url ?? null,
    localLogo:   getSocietyLogo(name),
    societyName: name,
    tagline:     s.tagline ?? '',
    societyId:   societyId!,
    loaded:      true,
    // Titan's own society always keeps its exact current look, regardless
    // of what ends up stored in its own primary/secondary colour columns.
    palette:     isTitan ? TITAN_PALETTE : derivePalette(primaryColor, secondaryColor),
  };
}

// ── Provider ──────────────────────────────────────────────────────
export function SocietyThemeProvider({ children }: { children: ReactNode }) {
  const [base,      setBase]      = useState<BaseTheme>(DEFAULT);
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(LIGHT_MODE_KEY).then(v => {
      if (v === 'true') setLightMode(true);
    });

    fetchTheme().then(setBase);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setBase({ ...DEFAULT, loaded: true });
      } else {
        fetchTheme().then(setBase);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  function toggleLightMode() {
    setLightMode(prev => {
      const next = !prev;
      AsyncStorage.setItem(LIGHT_MODE_KEY, String(next));
      return next;
    });
  }

  async function switchSociety(societyId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await AsyncStorage.setItem(societyKey(user.id), societyId);
    setBase(await fetchTheme());
  }

  const palette = lightMode
    ? deriveLightPalette(base.primaryColor, base.secondaryColor)
    : base.palette;

  const value: SocietyTheme = { ...base, palette, lightMode, toggleLightMode, switchSociety };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocietyTheme(): SocietyTheme {
  return useContext(Ctx);
}

/** Drop-in replacement for the static `colors` import — society-aware. */
export function useDynamicColors() {
  const { palette } = useSocietyTheme();
  return {
    bg:            palette.bg,
    card:          palette.card,
    cardAlt:       palette.card,
    border:        palette.border,
    gold:          palette.accent,
    goldDim:       hexToRgba(palette.accent, 0.15),
    goldBorder:    palette.goldBorder,
    white:         palette.text,
    textPrimary:   palette.text,
    textSecondary: palette.textSecondary,
    textMuted:     palette.textMuted,
    cardText:      palette.cardText,
    iconBoxBg:     palette.iconBoxBg,
    iconBoxBorder: palette.iconBoxBorder,
    iconBoxIcon:   palette.iconBoxIcon,
    green:         colors.green,
    red:           colors.red,
    grey:          colors.grey,
    live:          colors.live,
  };
}
