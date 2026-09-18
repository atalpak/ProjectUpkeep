/**
 * Small shared primitives for the mobile app — the same idea as
 * src/components/ui.tsx on the web side (not a design system, just enough to
 * stop every screen re-inventing a button), rebuilt in React Native and
 * routed through theme.ts tokens rather than Tailwind classes.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { accent, border, radius, space, surface, text as textColor, type } from '../theme';

export function Button({ label, onPress, disabled, secondary }: {
  label: string; onPress(): void; disabled?: boolean; secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}
    >
      <Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Choices({ values, selected, disabled, onSelect, labels = {} }: {
  values: string[]; selected?: string; disabled?: boolean; onSelect(v: string): void; labels?: Record<string, string>;
}) {
  return (
    <View style={styles.choices}>
      {values.map(v => (
        <Pressable
          key={v}
          accessibilityRole="radio"
          accessibilityState={{ selected: v === selected, disabled }}
          disabled={disabled}
          onPress={() => onSelect(v)}
          style={[styles.chip, v === selected && styles.chipSelected]}
        >
          <Text style={v === selected ? styles.chipTextSelected : styles.body}>{labels[v] ?? v.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Standing banner for a message/error — role="alert" like the web Banner. */
export function Notice({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={[styles.notice, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  button: { padding: space.lg, backgroundColor: accent.DEFAULT, borderRadius: radius.md, alignItems: 'center' },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: border.strong },
  buttonText: { fontFamily: type.title.fontFamily, fontSize: 15, fontWeight: '700', color: textColor.onAccent },
  secondaryText: { fontSize: 14, fontWeight: '600', color: textColor.secondary },
  disabled: { opacity: 0.4 },
  notice: { backgroundColor: surface.sunken, padding: space.lg - 2, borderRadius: radius.md, color: textColor.primary, fontSize: 13, lineHeight: 21 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline },
  chipSelected: { backgroundColor: surface.inverse, borderColor: surface.inverse },
  chipTextSelected: { color: textColor.inverse, fontSize: 13, lineHeight: 21 },
  body: { fontSize: 13, lineHeight: 21, color: textColor.secondary },
});
