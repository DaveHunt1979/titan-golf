import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import { supabase } from './supabase';
import { colors } from './theme';
import { getSocietyLogo } from './assets';

export interface ThemePalette {
  bg:            string;
  card:          string;
  border:        string;
  goldBorder:    string;
  accent:        string;
  text:          string;
  textSecondary: string;
  textMuted:     string;
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

export const TITAN_PALETTE: ThemePalette = {
  bg:            colors.bg,
  card:          colors.card,
  border:        colors.border,
  goldBorder:    colors.goldBorder,
  accent:        colors.gold,
  text:          colors.white,
  textSecondary: colors.textSecondary,
  textMuted:     colors.textMuted,
};

export function derivePalette(primaryColor: string, secondaryColor: string): ThemePalette {
  if (hexLuminance(primaryColor) < 0.15) {
    // Dark primary = brand background (e.g. Mashie #000035 navy)
    const accent = secondaryColor || '#ffffff';
    return {
      bg:            primaryColor,
      card:          lightenHex(primaryColor, 0.06),
      border:        'rgba(255,255,255,0.09)',
      goldBorder:    'rgba(255,255,255,0.22)',
      accent,
      text:          '#ffffff',
      textSecondary: 'rgba(255,255,255,0.68)',
      textMuted:     'rgba(255,255,255,0.38)',
    };
  }
  // Light/vibrant primary = accent colour (e.g. Titan gold)
  return { ...TITAN_PALETTE, accent: primaryColor };
}

export interface SocietyTheme {
  primaryColor:   string;
  secondaryColor: string;
  logoUrl:        string | null;
  localLogo:      any | null;
  societyName:    string;
  tagline:        string;
  societyId:      string;
  loaded:         boolean;
  palette:        ThemePalette;
}

const DEFAULT: SocietyTheme = {
  primaryColor:   colors.gold,
  secondaryColor: '#1B3A5C',
  logoUrl:        null,
  localLogo:      null,
  societyName:    'TITAN GOLF',
  tagline:        '',
  societyId:      '00000000-0000-0000-0000-000000000001',
  loaded:         false,
  palette:        TITAN_PALETTE,
};

const Ctx = createContext<SocietyTheme>(DEFAULT);

async function fetchTheme(): Promise<SocietyTheme> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...DEFAULT, loaded: true };

  const { data: player } = await supabase
    .from('players').select('id').eq('auth_uid', user.id).maybeSingle();
  if (!player) return { ...DEFAULT, loaded: true };

  const { data: member } = await supabase
    .from('society_members').select('society_id')
    .eq('player_id', (player as any).id)
    .order('society_id').limit(1).maybeSingle();
  if (!member) return { ...DEFAULT, loaded: true };

  const { data: society } = await supabase
    .from('societies')
    .select('name,tagline,primary_color,secondary_color,logo_url')
    .eq('id', (member as any).society_id)
    .single();

  if (!society) return { ...DEFAULT, societyId: (member as any).society_id, loaded: true };

  const s = society as any;
  const name           = s.name            ?? 'TITAN GOLF';
  const primaryColor   = s.primary_color   ?? colors.gold;
  const secondaryColor = s.secondary_color ?? '#1B3A5C';

  return {
    primaryColor,
    secondaryColor,
    logoUrl:   s.logo_url ?? null,
    localLogo: getSocietyLogo(name),
    societyName: name,
    tagline:   s.tagline ?? '',
    societyId: (member as any).society_id,
    loaded:    true,
    palette:   derivePalette(primaryColor, secondaryColor),
  };
}

export function SocietyThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<SocietyTheme>(DEFAULT);

  useEffect(() => {
    fetchTheme().then(setTheme);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setTheme({ ...DEFAULT, loaded: true });
      } else {
        fetchTheme().then(setTheme);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useSocietyTheme(): SocietyTheme {
  return useContext(Ctx);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
    green:         colors.green,
    red:           colors.red,
    grey:          colors.grey,
    live:          colors.live,
  };
}
