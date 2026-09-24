import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MANA_SYMBOL_IMAGES } from '../manaSymbols';

// Card-frame mana colours for the drawn-disc fallback, fixed rather than themed,
// like the location colour tags. Real symbols come from manaSymbols.ts; the disc
// only draws for a code we hold no art for.
const FALLBACK_COLORS: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#F8F6D8', fg: '#3A3520' },
  U: { bg: '#0E68AB', fg: '#FFFFFF' },
  B: { bg: '#2B2118', fg: '#F1E9DD' },
  R: { bg: '#D3202A', fg: '#FFFFFF' },
  G: { bg: '#00733E', fg: '#FFFFFF' },
  C: { bg: '#BDB6AB', fg: '#2B2118' },
};
const GENERIC = { bg: '#D6CFC2', fg: '#2B2118' };

const COLOUR_NAMES: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless', S: 'snow' };
const OTHER_NAMES: Record<string, string> = { X: 'X mana', Y: 'Y mana', Z: 'Z mana', P: 'Phyrexian mana', T: 'tap', Q: 'untap', E: 'energy' };

/** One slash-separated part on its own: "W" -> "white mana", "2" -> "2 generic mana", "HW" -> "half white mana". */
function partLabel(part: string): string {
  if (/^\d+$/.test(part)) return `${part} generic mana`;
  if (COLOUR_NAMES[part]) return `${COLOUR_NAMES[part]} mana`;
  const half = /^H([WUBRG])$/.exec(part);
  if (half) return `half ${COLOUR_NAMES[half[1]!]} mana`;
  return OTHER_NAMES[part] ?? `${part} symbol`;
}

/**
 * Spoken name of one symbol's inner code: "W" -> "white mana", "2/W" -> "2 generic mana
 * or white mana", "W/P" -> "white mana or 2 life", "P" -> "Phyrexian mana".
 */
export function manaLabel(code: string): string {
  const parts = code.toUpperCase().split('/');
  const phyrexian = parts.length > 1 && parts[parts.length - 1] === 'P';
  const named = (phyrexian ? parts.slice(0, -1) : parts).map(partLabel);
  if (phyrexian) named.push('2 life');
  return named.join(' or ');
}

/**
 * One mana symbol, drawn from the bundled Scryfall art (manaSymbols.ts). Hybrid and
 * Phyrexian codes ("R/G", "R/P") are looked up with the slash removed. An unknown
 * code falls back to a small coloured disc with its letters.
 */
export function ManaSymbol({ code, size = 16, hidden = false }: { code: string; size?: number; hidden?: boolean }) {
  const source = MANA_SYMBOL_IMAGES[code.replace(/\//g, '').toUpperCase()];
  // Inside a ManaCost row the row carries the label, so each symbol steps out of the
  // accessibility tree rather than being read twice.
  const a11y = hidden
    ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
    : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: manaLabel(code) };
  if (source) return <Image source={source} style={{ width: size, height: size }} resizeMode="contain" {...a11y} />;
  const first = code.split('/')[0]!.toUpperCase();
  const palette = FALLBACK_COLORS[first] ?? GENERIC;
  return (
    <View {...a11y} style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.bg }]}>
      <Text style={{ color: palette.fg, fontSize: Math.max(7, size * (code.length > 2 ? 0.42 : 0.6)), fontWeight: '800' }}>{code.replace('/', '')}</Text>
    </View>
  );
}

/** A printed mana cost such as "{2}{R}{G}" as a row of symbols. Renders nothing for an empty cost. */
export function ManaCost({ cost, size = 16 }: { cost: string | null | undefined; size?: number }) {
  if (!cost) return null;
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map(m => m[1]!);
  if (!symbols.length) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={`Mana cost ${symbols.map(manaLabel).join(', ')}`}>
      {symbols.map((s, i) => <ManaSymbol key={i} code={s} size={size} hidden />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  disc: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.35)' },
});
