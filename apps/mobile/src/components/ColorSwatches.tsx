import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LOCATION_COLORS, LOCATION_COLOR_HEX, type LocationColor } from '../locations';
import { makeStyles } from '../preferences';
import { border, space, text } from '../theme';

/** Row of colour dots for tagging a location, plus a "no colour" choice. */
export function ColorSwatches({ value, onChange, disabled }: { value: LocationColor | null; onChange(c: LocationColor | null): void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: value === null, disabled }} accessibilityLabel="No colour" disabled={disabled} onPress={() => onChange(null)} style={[styles.dot, styles.none, value === null && styles.selected]}>
        <Ionicons name="close" size={16} color={text.secondary} />
      </Pressable>
      {LOCATION_COLORS.map(c => (
        <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: value === c, disabled }} accessibilityLabel={c} disabled={disabled} onPress={() => onChange(c)} style={[styles.dot, { backgroundColor: LOCATION_COLOR_HEX[c] }, value === c && styles.selected]} />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  none: { borderColor: border.strong },
  selected: { borderColor: text.primary },
}));
