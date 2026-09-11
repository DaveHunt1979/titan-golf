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

// ── Dark palette ──────────────────────────────────────────────────
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

// ── Light palette ─────────────────────────────────────────────────
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
  const name = s.name ?? 'TITAN GOLF';
  // Still surfaced on SocietyTheme and read directly by other screens, but no
  // longer drives the palette — every society is locked to Titan black/gold.
  const primaryColor   = s.primary_color   ?? colors.gold;
  const secondaryColor = s.secondary_color ?? '';

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
    // Every society uses Titan's black/gold look — custom society colours
    // were removed; only logo and hero image are customisable now.
    palette:     TITAN_PALETTE,
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

  const palette = lightMode ? TITAN_LIGHT_PALETTE : base.palette;

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
