import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles } from '../preferences';
import { border, surface, text } from '../theme';

/**
 * The flip control for a two-sided card, drawn over the corner of its picture.
 * Rendered only when the card can flip (see `useCardFace`), so a split or
 * adventure card never shows one.
 *
 * The visible circle is small so it does not hide the art, and `hitSlop`
 * grows the touch area to the 44pt floor. It is a sibling-level Pressable in
 * the tile, so a press flips instead of opening the row it sits on.
 */
export function FlipBadge({ onPress, otherName, size = 26, corner = 'top-left' }: {
  onPress(): void; otherName: string | null; size?: number; corner?: 'top-left' | 'bottom-right';
}) {
  const styles = useStyles();
  const slop = Math.max(0, Math.ceil((44 - size) / 2));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={otherName ? `Flip card to ${otherName}` : 'Flip card'}
      hitSlop={slop}
      onPress={onPress}
      style={({ pressed }) => [styles.badge, { width: size, height: size, borderRadius: size / 2 }, corner === 'top-left' ? styles.topLeft : styles.bottomRight, pressed && styles.pressed]}
    >
      <Ionicons name="sync-outline" size={Math.round(size * 0.62)} color={text.primary} />
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  badge: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: surface.raised, borderWidth: 1, borderColor: border.strong },
  pressed: { opacity: 0.7 },
  topLeft: { top: 4, left: 4 },
  bottomRight: { bottom: 2, right: 2 },
}));
