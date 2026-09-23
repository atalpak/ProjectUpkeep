/**
 * Small shared primitives for the mobile app — the same idea as
 * src/components/ui.tsx on the web side (not a design system, just enough to
 * stop every screen re-inventing a button), rebuilt in React Native and
 * routed through theme.ts tokens rather than Tailwind classes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { accent, border, radius, scrim, space, surface, text as textColor, type } from '../theme';
import { makeStyles } from '../preferences';
import { useReducedMotion } from '../hooks/useReducedMotion';

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
 * Generic bottom sheet: a scrim behind a panel that slides up from the bottom
 * edge, with a fixed header and an optional fixed footer around a scrolling
 * body -- the shape any "large sheet of controls that might not fit" screen
 * needs (first user: the collection filter panel, mobile UI brief Priority 3,
 * whose old inline panel was clamped to 40% of the screen and didn't make
 * clear that it scrolled). Same Modal + Animated.View + scrim shape as
 * MenuSheet, sliding up instead of in from the side, with the header/body/
 * footer split MenuSheet doesn't need since it has no footer action.
 *
 * Height is a proportion of the window (`maxHeightRatio`), not a fixed pixel
 * value, so it never clips on a short phone or with larger text settings --
 * the body inside just gets less room to scroll rather than the sheet itself
 * overflowing. No drag-to-dismiss or snap points: nothing in this app needs
 * them yet, and building that machinery speculatively is out of scope for
 * what a filter sheet actually asks for (fixed open/closed, like MenuSheet).
 */
export function BottomSheet({ visible, onClose, title, footer, children, maxHeightRatio = 0.85 }: {
  visible: boolean; onClose(): void; title: string; footer?: React.ReactNode; children: React.ReactNode; maxHeightRatio?: number;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const sheetHeight = windowHeight * maxHeightRatio;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: reducedMotion ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: reducedMotion ? 0 : 180, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible, reducedMotion, progress]);

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetRoot}>
        <Animated.View style={[styles.sheetScrim, { opacity: progress }]}>
          <Pressable accessibilityLabel={`Close ${title}`} style={styles.sheetScrimFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheetPanel,
            { maxHeight: sheetHeight, paddingBottom: insets.bottom || space.md },
            { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }) }] },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${title}`} hitSlop={8} onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={24} color={textColor.primary} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
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
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim },
  sheetScrimFill: { flex: 1 },
  sheetPanel: { backgroundColor: surface.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: border.hairline, borderBottomWidth: 0 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  sheetTitle: { ...type.title, color: textColor.primary },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { padding: space.lg, gap: space.sm },
  sheetFooter: { flexDirection: 'row', gap: space.sm, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border.hairline },
}));
