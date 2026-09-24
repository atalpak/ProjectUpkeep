/**
 * Small shared primitives for the mobile app — the same idea as
 * src/components/ui.tsx on the web side (not a design system, just enough to
 * stop every screen re-inventing a button), rebuilt in React Native and
 * routed through theme.ts tokens rather than Tailwind classes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type DimensionValue, type PressableProps, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { accent, border, iconButtonSize, radius, scrim, space, surface, text as textColor, type } from '../theme';
import { makeStyles } from '../preferences';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Primary/secondary action button, with the shared pressed/focused/disabled/
 * loading treatments Priority 4 of the mobile UI refinement brief asks for --
 * before this, `disabled` was the only state `Button` handled at all: no
 * dimming on press, no busy indicator (a caller wanting one, e.g.
 * `SettingsScreen`'s "Deleting…" label, faked it with plain label text and
 * still let the tap fire again), and `secondary`'s label was the one place in
 * the app rendering `fontWeight` with no `fontFamily` at all -- it fell back
 * to the system font silently. `loading` folds into `disabled` for
 * `accessibilityState`/press-blocking rather than adding a second gate.
 */
export function Button({ label, onPress, disabled, secondary, loading }: {
  label: string; onPress(): void; disabled?: boolean; secondary?: boolean; loading?: boolean;
}) {
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  const busy = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, busy: loading }}
      onPress={onPress}
      disabled={busy}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        focused && styles.buttonFocused,
        busy && styles.disabled,
        pressed && !busy && styles.buttonPressed,
      ]}
    >
      {loading
        ? <ActivityIndicator color={secondary ? textColor.secondary : textColor.onAccent} />
        : <Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

/**
 * A plain icon-only control at the app's one shared touch-target size --
 * AppHeader's back chevron and menu button, MenuSheet's and BottomSheet's
 * close buttons all used to hand-roll this same 44x44-centered-icon shape
 * separately, each with its own pressed feedback (none had any). One
 * component now owns the size, the pressed dim, and the accessibility role.
 */
export function IconButton({ icon, onPress, accessibilityLabel, size = iconButtonSize, iconSize, color, style }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; onPress(): void; accessibilityLabel: string; size?: number;
  /** The glyph's own size, independent of the touch-target box. Defaults to
   *  a size proportional to `size`, but every call site this replaced had
   *  its own explicit glyph size (26 for AppHeader's back/menu icons, 24 for
   *  a sheet's close icon) — pass it explicitly to preserve that, since
   *  `size` alone is the 44pt touch target, not the glyph. */
  iconSize?: number; color?: string; style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { width: size, height: size }, pressed && styles.iconButtonPressed, style]}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.5)} color={color ?? textColor.primary} />
    </Pressable>
  );
}

/**
 * A small numeric/text pill for an overlay count -- AppHeader's unread badge,
 * MenuSheet's notification count and Collection's quantity badges each
 * rendered this by hand, two of them with `fontWeight` and no `fontFamily`.
 * Positioning (where the badge sits on its parent) stays with the caller,
 * since that varies by context; only the pill's own shape and text style are
 * shared.
 */
export function Badge({ value, style }: { value: string | number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  return (
    <View style={[styles.badgePill, style]}>
      <Text style={styles.badgeText}>{value}</Text>
    </View>
  );
}

/**
 * A Pressable that always answers a touch. Every tappable row, tile and link in
 * the app used a bare `Pressable` with no pressed style, so a tap gave no
 * feedback until the next screen arrived (mobile UI brief Priority 7).
 * `fill` tints the surface (rows and list items, where the whole strip is the
 * target); `dim` fades it (image tiles and cards, where a tint would fight the
 * artwork). Layout, role and label stay the caller's -- this only owns the
 * pressed treatment, so swapping it in for `Pressable` changes nothing else.
 */
export function Tappable({ feedback = 'fill', style, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & {
  feedback?: 'fill' | 'dim'; style?: StyleProp<ViewStyle>; children?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, pressed && !rest.disabled && (feedback === 'dim' ? styles.pressedDim : styles.pressedFill)]}
    >
      {children}
    </Pressable>
  );
}

/**
 * The one text field. Eight screens each hand-rolled a bordered `TextInput`
 * that differed only in background, padding and a few props; this owns the
 * look (radius.md, type.input, the 48pt height that keeps the target above
 * 44pt, a focus ring matching Button's) and passes every other `TextInput`
 * prop straight through, so multiline, autoCapitalize, autoCorrect, keyboard
 * type and the rest stay each call site's own decision. `tone` is the one
 * appearance choice: `raised` on the page canvas, `canvas` when the field sits
 * inside a raised card or sheet (a raised field there would vanish).
 * `accessibilityLabel` is required because a placeholder is not a label.
 */
export function TextField({ tone = 'raised', style, onFocus, onBlur, multiline, editable, ...rest }: TextInputProps & {
  accessibilityLabel: string; tone?: 'raised' | 'canvas';
}) {
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={textColor.secondary}
      {...rest}
      multiline={multiline}
      editable={editable}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
      style={[
        styles.field,
        tone === 'canvas' && styles.fieldCanvas,
        multiline && styles.fieldMultiline,
        focused && styles.fieldFocused,
        editable === false && styles.disabled,
        style,
      ]}
    />
  );
}

/** The trailing "opens something" chevron on a tappable row. Replaces the `›` text glyph each screen used to set in the system font at its own size. */
export function Chevron() {
  return <Ionicons name="chevron-forward" size={18} color={textColor.secondary} accessibilityElementsHidden importantForAccessibility="no" />;
}

/**
 * A grouped list surface: one raised, bordered panel whose rows are separated
 * by hairline dividers, instead of each row being its own bordered card
 * (mobile UI brief Priority 5). Use for routine lists -- locations, friends,
 * trades, notifications. Stays a card for things that need to stand out
 * (metrics, artwork tiles, forms). Rows are `GroupRow`s.
 */
export function ListGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const rows = React.Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View style={[styles.group, style]}>
      {rows.map((row, i) => (
        <React.Fragment key={React.isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 && <View style={styles.groupDivider} />}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
}

/** One row inside a `ListGroup`: tappable (with pressed feedback) when it has an `onPress`, otherwise a plain row. */
export function GroupRow({ onPress, accessibilityLabel, accessibilityRole = 'button', style, children }: {
  onPress?(): void; accessibilityLabel?: string; accessibilityRole?: 'button' | 'link'; style?: StyleProp<ViewStyle>; children: React.ReactNode;
}) {
  const styles = useStyles();
  if (!onPress) return <View style={[styles.groupRow, style]}>{children}</View>;
  return (
    <Tappable accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} onPress={onPress} style={[styles.groupRow, style]}>
      {children}
    </Tappable>
  );
}

/**
 * A placeholder block for content that is still loading, so the page keeps its
 * final shape instead of jumping when data lands (Priority 7). Pulses gently;
 * under reduced motion it holds still at the resting opacity. Decorative, so
 * hidden from screen readers -- the screen announces loading some other way.
 */
export function Skeleton({ width = '100%', height, corner = radius.md, style }: {
  width?: DimensionValue; height: number; corner?: number; style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) { pulse.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.skeleton, { width, height, borderRadius: corner, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }, style]}
    />
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
          style={({ pressed }) => [styles.chip, v === selected && styles.chipSelected, pressed && !disabled && styles.chipPressed]}
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
            <IconButton icon="close" iconSize={24} accessibilityLabel={`Close ${title}`} onPress={onClose} style={styles.sheetClose} />
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
  button: { padding: space.lg, backgroundColor: accent.DEFAULT, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: border.strong },
  buttonFocused: { borderColor: accent.DEFAULT },
  buttonPressed: { opacity: 0.8 },
  buttonText: { ...type.buttonLabel, color: textColor.onAccent },
  secondaryText: { ...type.buttonLabel, color: textColor.secondary },
  disabled: { opacity: 0.4 },
  notice: { backgroundColor: surface.sunken, padding: space.md, borderRadius: radius.md, color: textColor.primary, ...type.bodySm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline },
  chipSelected: { backgroundColor: surface.inverse, borderColor: surface.inverse },
  chipPressed: { opacity: 0.7 },
  pressedFill: { backgroundColor: surface.sunken },
  pressedDim: { opacity: 0.7 },
  field: { minHeight: 48, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised, color: textColor.primary, ...type.input },
  fieldCanvas: { backgroundColor: surface.canvas },
  fieldMultiline: { textAlignVertical: 'top' },
  fieldFocused: { borderColor: accent.DEFAULT },
  group: { borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, overflow: 'hidden' },
  groupDivider: { height: StyleSheet.hairlineWidth, backgroundColor: border.hairline, marginLeft: space.lg },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.md },
  skeleton: { backgroundColor: surface.sunken },
  chipTextSelected: { ...type.bodySm, color: textColor.inverse },
  body: { ...type.bodySm, color: textColor.secondary },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  iconButtonPressed: { backgroundColor: surface.sunken },
  badgePill: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: radius.pill, backgroundColor: accent.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...type.statusBadge, color: textColor.onAccent },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim },
  sheetScrimFill: { flex: 1 },
  sheetPanel: { backgroundColor: surface.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: border.hairline, borderBottomWidth: 0 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  sheetTitle: { ...type.title, color: textColor.primary },
  sheetClose: { marginRight: -space.sm },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { padding: space.lg, gap: space.sm },
  sheetFooter: { flexDirection: 'row', gap: space.sm, padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border.hairline },
}));
