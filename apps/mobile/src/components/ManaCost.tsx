import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Card-frame mana colours; fixed rather than themed, like the location colour tags.
export const MANA_COLORS: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#F8F6D8', fg: '#3A3520' },
  U: { bg: '#0E68AB', fg: '#FFFFFF' },
  B: { bg: '#2B2118', fg: '#F1E9DD' },
  R: { bg: '#D3202A', fg: '#FFFFFF' },
  G: { bg: '#00733E', fg: '#FFFFFF' },
  C: { bg: '#BDB6AB', fg: '#2B2118' },
};
const GENERIC = { bg: '#D6CFC2', fg: '#2B2118' };

/** One mana symbol as a small coloured disc. Hybrid and Phyrexian symbols ("R/G", "R/P") take their first colour and show their letters. */
export function ManaSymbol({ code, size = 16 }: { code: string; size?: number }) {
  const first = code.split('/')[0]!.toUpperCase();
  const palette = MANA_COLORS[first] ?? GENERIC;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.bg }]}>
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
    <View style={styles.row} accessibilityLabel={`Mana cost ${symbols.join(' ')}`}>
      {symbols.map((s, i) => <ManaSymbol key={i} code={s} size={size} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  disc: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.35)' },
});
