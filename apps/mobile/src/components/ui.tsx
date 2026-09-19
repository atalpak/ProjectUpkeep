/**
 * Small shared primitives for the mobile app — the same idea as
 * src/components/ui.tsx on the web side (not a design system, just enough to
 * stop every screen re-inventing a button), rebuilt in React Native and
 * routed through theme.ts tokens rather than Tailwind classes.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { accent, border, radius, space, surface, text as textColor, type } from '../theme';
import { makeStyles } from '../preferences';

export function Button({ label, onPress, disabled, secondary }: {
  label: string; onPress(): void; disabled?: boolean; secondary?: boolean;
}) {
  const styles = useStyles();
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
  const styles = useStyles();
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
  const styles = useStyles();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={[styles.notice, style]}>
      {children}
    </Text>
  );
}

/**
 * A Notice that holds for a few seconds, then slides up and fades out before
 * calling `onDone` (which should clear the message). Restarts whenever
 * `children` changes, so a new message gets its full time on screen.
 */
export function DismissingNotice({ children, onDone, style, holdMs = 5000 }: { children: string; onDone(): void; style?: StyleProp<ViewStyle>; holdMs?: number }) {
  const progress = useRef(new Animated.Value(1)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    progress.setValue(1);
    const anim = Animated.sequence([
      Animated.delay(holdMs),
      Animated.timing(progress, { toValue: 0, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => { if (finished) done.current(); });
    return () => anim.stop();
  }, [children, holdMs, progress]);
  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] }}>
      <Notice style={style}>{children}</Notice>
    </Animated.View>
  );
}

/**
 * A friendly empty page: Mort, a headline, one line of why, and the next step
 * as children (buttons). Only offer next steps that exist in the app today.
 */
export function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.emptyWrap}>
      <Image source={require('../mort/assets/mort_file.png')} style={styles.emptyMort} accessibilityIgnoresInvertColors />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {children ? <View style={styles.emptyActions}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  emptyWrap: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  emptyMort: { width: 96, height: 96, resizeMode: 'contain' },
  emptyTitle: { ...type.title, color: textColor.primary, textAlign: 'center' },
  emptyBody: { ...type.bodySm, color: textColor.secondary, textAlign: 'center' },
  emptyActions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
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
}));
