/**
 * Single source of design tokens for the mobile app. Nothing outside this
 * file should hardcode a hex value, a font size, a radius or a duration —
 * see CLAUDE.md's design-rollout notes and the brand handoff doc
 * (project_upkeep_brand_mort_developer_handoff.md §6) for why: the brand
 * sheet's own developer note says printed/finalized values are the source of
 * truth, not anything pixel-sampled from generated art, and routing every
 * call site through tokens is what makes a future font-family or palette
 * revision a one-line change here instead of a grep-and-replace across every
 * screen.
 *
 * Fonts are the one thing this file deliberately does NOT introduce new
 * values for: Cinzel_600SemiBold and PlusJakartaSans stay as loaded in
 * App.tsx today (owner decision, not a design pass) — `type.*` below name
 * weights/sizes, not families, so swapping families later is still a
 * one-line change to the two family constants.
 */

export const fontFamily = {
  display: 'Cinzel_600SemiBold',
  displayFallback: undefined as string | undefined,
  body: 'PlusJakartaSans_400Regular',
  bodySemiBold: 'PlusJakartaSans_600SemiBold',
};

export const brand = {
  ink: '#1F1F1F',
  parchment: '#F5EDE0',
  bone: '#D9D1C2',
  leather: '#6B4E3D',
  ochre: '#C9A34A',
  accentRed: '#B24D3C',
} as const;

// Mort Green/Deep Moss belong to character art only — zero app chrome may
// reference these. Kept here only so the Mort controller/stage has a single
// place to pull a placeholder tint from until real art exists.
export const mort = {
  green: '#BB9B5A',
  deepMoss: '#5A6B3F',
} as const;

export type Scheme = 'light' | 'dark';

const palettes = {
  light: {
    surface: {
      canvas: brand.parchment,
      // One step up from canvas -- for cards/panels that need to separate from
      // the page background without a hard border.
      raised: '#FDF8EF',
      // One step down -- pressed states, recessed wells.
      sunken: '#EAE0CF',
      inverse: brand.ink,
    },
    border: { hairline: brand.bone, strong: '#C3B8A4' },
    text: { primary: brand.ink, secondary: brand.leather, inverse: brand.parchment, onAccent: brand.ink },
    accent: { DEFAULT: brand.ochre, soft: '#F0E3C4' },
    state: { success: mort.deepMoss, error: brand.accentRed, warning: brand.ochre },
  },
  dark: {
    surface: { canvas: '#1B1815', raised: '#26221D', sunken: '#141210', inverse: brand.parchment },
    border: { hairline: '#3A342C', strong: '#4B4338' },
    text: { primary: '#F2EADB', secondary: '#BFB29C', inverse: brand.ink, onAccent: brand.ink },
    accent: { DEFAULT: brand.ochre, soft: '#3B3220' },
    state: { success: '#93A874', error: '#D9705E', warning: brand.ochre },
  },
} as const;

// These token groups are LIVE: `applyScheme` overwrites their values in place
// when the resolved scheme changes (see preferences.tsx), so every reader --
// inline `color={text.primary}` included -- picks up the new palette on its
// next render. Styles built from them go through `makeStyles`, which keeps one
// StyleSheet per scheme; nothing should call StyleSheet.create at module level
// with these any more.
export const surface: { canvas: string; raised: string; sunken: string; inverse: string } = { ...palettes.light.surface };
export const border: { hairline: string; strong: string } = { ...palettes.light.border };
export const text: { primary: string; secondary: string; inverse: string; onAccent: string } = { ...palettes.light.text };
export const accent: { DEFAULT: string; soft: string } = { ...palettes.light.accent };
export const state: { success: string; error: string; warning: string } = {
  // Warning fails contrast as text (brand.ochre against parchment/white) --
  // fills and icons only, per the design spec. Never a state label's colour.
  ...palettes.light.state,
};

export function applyScheme(scheme: Scheme): void {
  const p = palettes[scheme];
  Object.assign(surface, p.surface);
  Object.assign(border, p.border);
  Object.assign(text, p.text);
  Object.assign(accent, p.accent);
  Object.assign(state, p.state);
}

export const scrim = 'rgba(31,31,31,0.55)';

type TypeToken = { fontSize: number; lineHeight: number; fontFamily: string; fontWeight?: '400' | '600' | '700'; letterSpacing?: number; fontStyle?: 'italic' };

export const type: Record<
  'display' | 'title' | 'body' | 'bodySm' | 'label' | 'eyebrow' | 'mort',
  TypeToken
> = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.display, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 26, fontFamily: fontFamily.bodySemiBold, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.body, fontWeight: '400' },
  bodySm: { fontSize: 13, lineHeight: 20, fontFamily: fontFamily.body, fontWeight: '400' },
  label: { fontSize: 11, lineHeight: 14, fontFamily: fontFamily.bodySemiBold, fontWeight: '600', letterSpacing: 0.2 },
  eyebrow: { fontSize: 10, lineHeight: 12, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', letterSpacing: 2 },
  // Mort voice lines only -- see the brand doc's "Project Upkeep voice vs
  // Mort voice" section. Never used for routine system copy.
  mort: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.body, fontWeight: '400', fontStyle: 'italic' },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

// Milliseconds. `reactLong` covers the NONE band's longer hold (see
// ScanScreen); `file` is the save-success reaction's fixed duration.
export const duration = { micro: 200, quick: 300, react: 700, reactLong: 900, file: 800 } as const;
