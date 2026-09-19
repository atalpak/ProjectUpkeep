import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { ScanPipeline, quickMatch } from '@upkeep/scan-core';
import { UpkeepScannerView, readText, scannerViewAvailable, type CardReadEvent } from '@upkeep/vision';
import { useApp } from '../AppProvider';
import { useOpenCardDetails } from '../cardDetailsHost';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { makeStyles, usePreferences } from '../preferences';
import { PAGES, type PageId } from '../navigation';
import { useSearchOverlay } from '../searchOverlay';
import { accent, border, brand, radius, space, surface, text, type } from '../theme';

const BAR_HEIGHT = 50;
// How far the Scan button rises above the bar. The bar's own container is
// this much taller than its background so the raised part is still inside the
// container's bounds -- iOS drops touches outside a parent's frame.
const PROTRUDE = 26;
const SCAN_SIZE = 74;
const CENTER = 2;
// Side padding for the row of slots: pulls the outer icons in from the screen edge (and the inner ones slightly).
const ROW_INSET = 14;

/**
 * Five slots: two user-chosen pages, Scan (fixed, raised, centre), two more.
 * Any page can be navigated to from the menu without being in the bar; the
 * bar just shows the pinned ones. Wired in via `tabBar={props => <TabBar />}`
 * so React Navigation still supplies real screens, back gestures and
 * per-screen scroll position.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const styles = useStyles();
  const { slots } = usePreferences();
  const search = useSearchOverlay();
  const [barWidth, setBarWidth] = useState(0);
  const itemWidth = barWidth > 0 ? (barWidth - 2 * ROW_INSET) / 5 : 0;

  const order: PageId[] = [slots[0], slots[1], 'Scan', slots[2], slots[3]];
  const current = state.routes[state.index]?.name as PageId | undefined;

  function onLayout(e: LayoutChangeEvent) { setBarWidth(e.nativeEvent.layout.width); }

  function go(page: PageId) {
    // Search is a slide-in bar, not a page: same action from the bar, the menu and the fan.
    if (page === 'Search') { search.open(); return; }
    const route = state.routes.find(r => r.name === page);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (current !== page && !event.defaultPrevented) navigation.navigate(page);
  }

  // The home indicator sits in the lower part of the inset; icons need not clear all of it.
  const bottom = Math.max(insets.bottom - 18, 6);
  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      pointerEvents="box-none"
      style={[styles.bar, { height: PROTRUDE + BAR_HEIGHT + bottom, paddingBottom: bottom, paddingTop: PROTRUDE, paddingHorizontal: ROW_INSET }]}
    >
      <View pointerEvents="none" style={styles.background} />
      {order.map((page, i) => {
        const info = PAGES[page];
        const selected = current === page;
        if (i === CENTER) return <ScanButton key={page} width={itemWidth} selected={selected} onPress={() => go('Scan')} onSearch={search.open} />;
        return (
          <TabBarItem
            key={page}
            width={itemWidth}
           
            selected={selected}
            label={info.short ?? info.title}
            iconName={selected ? info.filled : info.outline}
            onPress={() => go(page)}
          />
        );
      })}
    </View>
  );
}

const HOLD_MS = 280;
// The radial menu is a half-disc that rises from behind the bar. Its centre is
// the Scan circle's centre; the visible half is clipped at the bar's top edge.
const DOME_R = 130;
const OPTION = 60;
const OPTION_DX = 66;
const OPTION_DY = 52;
const DEAD_ZONE = 34;
// Quick scan: the camera warms up the moment the finger reaches the Scan
// option, and the box reveals after holding there this long.
const DWELL_MS = 200;
const QUICK_W = 240;
const QUICK_H = 330;
type FanOption = 'search' | 'scan';

/**
 * The fixed centre button. A tap opens Scan straight away. Press and hold and
 * two options fan out above it (Search left, Scan right): slide onto one and
 * let go to open it; let go anywhere else to cancel. One PanResponder owns the
 * whole touch, so the fan needs no hit-testing of its own -- the finger's
 * window position is compared to where the bubbles are drawn.
 */
function ScanButton({ width, selected, onPress, onSearch }: { width: number; selected: boolean; onPress(): void; onSearch(): void }) {
  const styles = useStyles();
  const reducedMotion = useReducedMotion();
  const app = useApp();
  const openDetails = useOpenCardDetails();
  const [permission] = useCameraPermissions();
  const pipeline = useMemo(() => new ScanPipeline(app.index, { readText }), [app.index]);
  const scale = useRef(new Animated.Value(1)).current;
  const fan = useRef(new Animated.Value(0)).current;
  const quickAnim = useRef(new Animated.Value(0)).current;
  const [quick, setQuick] = useState(false);
  // The camera is mounted (hidden) from the moment the finger reaches the Scan
  // option, so it is already producing frames when the box is revealed.
  const [warm, setWarm] = useState(false);
  const pendingRead = useRef<CardReadEvent | null>(null);
  const [quickHint, setQuickHint] = useState('');
  const [fanNote, setFanNote] = useState('');
  const quickRef = useRef(false);
  // Set once a quick scan resolved a card, so the finger lifting afterwards
  // does not also fire the fan's own "open Scan".
  const doneRef = useRef(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fanOpen, setFanOpen] = useState(false);
  const [hover, setHover] = useState<FanOption | null>(null);
  const circle = useRef<View>(null);
  const center = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(false);
  const hoverRef = useRef<FanOption | null>(null);
  const actions = useRef({ onPress, onSearch });
  actions.current = { onPress, onSearch };
  const canQuick = scannerViewAvailable && !!permission?.granted && !app.demo && app.active && !app.disabled;
  const blocker = !scannerViewAvailable ? 'Quick scan needs the live scanner (iPhone).'
    : !permission ? 'Checking camera access…'
    : !permission.granted ? 'Open the Scan tab once to allow the camera.'
    : app.demo ? 'Card database not downloaded yet.'
    : 'Busy right now. Try again in a moment.';
  const env = useRef({ canQuick, pipeline, openDetails, blocker });
  env.current = { canQuick, pipeline, openDetails, blocker };

  function setHoverBoth(next: FanOption | null) {
    // Once the camera box is up, finger jitter must not change anything.
    if (quickRef.current || hoverRef.current === next) return;
    hoverRef.current = next;
    setHover(next);
    if (dwell.current) { clearTimeout(dwell.current); dwell.current = null; }
    if (next === 'scan' && env.current.canQuick) { setWarm(true); dwell.current = setTimeout(startQuick, DWELL_MS); }
    else setWarm(false);
    // Say why, rather than silently doing nothing, when quick scan can't start.
    setFanNote(next === 'scan' && !env.current.canQuick ? env.current.blocker : '');
  }

  function startQuick() {
    dwell.current = null;
    quickRef.current = true;
    doneRef.current = false;
    setQuickHint('Hold a card up to the camera');
    setQuick(true);
    if (reducedMotion) quickAnim.setValue(1);
    else Animated.spring(quickAnim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 220 }).start();
    // A card that was read while the camera was still hidden is not lost:
    // the native side reads each physical card once, so it will not repeat it.
    const early = pendingRead.current;
    pendingRead.current = null;
    if (early) handleRead(early);
  }

  function stopQuick() {
    pendingRead.current = null;
    setWarm(false);
    if (!quickRef.current) return;
    quickRef.current = false;
    setQuick(false);
    quickAnim.setValue(0);
  }

  function onQuickRead(event: { nativeEvent: CardReadEvent }) {
    if (!quickRef.current) { pendingRead.current = event.nativeEvent; return; }
    handleRead(event.nativeEvent);
  }

  function handleRead({ lines, printingLines }: CardReadEvent) {
    const candidates = env.current.pipeline.matchEvidence({ lines, printingLines }).candidates;
    const match = quickMatch(candidates);
    if ('reason' in match) {
      // The scanner reads each physical card once, so a rejected read needs the card taken away and shown again.
      setQuickHint(match.reason === 'ambiguous' ? 'Not sure which card that is. Take it away and try again.' : 'Couldn’t read that clearly. Take it away and try again.');
      return;
    }
    const { printing, exactPrinting } = match;
    doneRef.current = true;
    stopQuick();
    closeFan();
    // Pin the printing only when its set and number were actually read; a
    // name-only match carries an arbitrary printing of that card.
    env.current.openDetails({
      name: printing.name,
      printingId: exactPrinting ? printing.id : null,
      note: exactPrinting ? `Scanned as ${printing.setCode.toUpperCase()} #${printing.collectorNumber}. Not right? Pick the printing below.` : undefined,
    });
  }

  function openFan() {
    openRef.current = true;
    setFanOpen(true);
    setHoverBoth(null);
    Animated.spring(fan, { toValue: 1, useNativeDriver: true, friction: 7, tension: 120 }).start();
    if (reducedMotion) fan.setValue(1);
  }

  function closeFan() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (dwell.current) { clearTimeout(dwell.current); dwell.current = null; }
    stopQuick();
    Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    if (!openRef.current) return;
    openRef.current = false;
    setHoverBoth(null);
    Animated.timing(fan, { toValue: 0, duration: reducedMotion ? 0 : 140, useNativeDriver: true }).start(({ finished }) => { if (finished) setFanOpen(false); });
  }

  // The dome is split down the middle: left half is Search, right half Scan.
  // Right over the button itself, or outside the dome, selects nothing.
  function pick(x: number, y: number): FanOption | null {
    const dx = x - center.current.x;
    const dy = y - center.current.y;
    const dist = Math.hypot(dx, dy);
    if (dy > -6 || dist < DEAD_ZONE || dist > DOME_R + 24) return null;
    return dx < 0 ? 'search' : 'scan';
  }

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // Once we have the touch, keep it: the bar's siblings must not steal a drag.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      doneRef.current = false;
      Animated.timing(scale, { toValue: 0.94, duration: 80, useNativeDriver: true }).start();
      circle.current?.measureInWindow((x, y, w, h) => { center.current = { x: x + w / 2, y: y + h / 2 }; });
      timer.current = setTimeout(openFan, HOLD_MS);
    },
    onPanResponderMove: (_, g) => { if (openRef.current) setHoverBoth(pick(g.moveX, g.moveY)); },
    onPanResponderRelease: (_, g) => {
      const wasOpen = openRef.current;
      // Lifting during a quick scan cancels it; lifting after one resolved does nothing more.
      const cancelled = quickRef.current || doneRef.current;
      const chosen = wasOpen ? pick(g.moveX, g.moveY) : null;
      closeFan();
      if (cancelled) return;
      if (!wasOpen) actions.current.onPress();
      else if (chosen === 'scan') actions.current.onPress();
      else if (chosen === 'search') actions.current.onSearch();
    },
    onPanResponderTerminate: closeFan,
  })).current;

  return (
    <View
      accessible
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel="Scan"
      accessibilityActions={[{ name: 'activate', label: 'Scan' }, { name: 'search', label: 'Search' }]}
      onAccessibilityAction={e => (e.nativeEvent.actionName === 'search' ? actions.current.onSearch() : actions.current.onPress())}
      style={[styles.scanItem, width > 0 && { flex: 0, width }]}
      {...responder.panHandlers}
    >
      {fanOpen && !quick && (
        <>
          <View pointerEvents="none" style={styles.domeClip}>
            <Animated.View style={[styles.dome, { transform: [{ translateY: fan.interpolate({ inputRange: [0, 1], outputRange: [DOME_R, 0] }) }] }]} />
          </View>
          {!!fanNote && <Text pointerEvents="none" style={styles.fanNote}>{fanNote}</Text>}
          <View pointerEvents="none" style={styles.fanLayer}>
            <FanOption label="Search" icon="search" hovered={hover === 'search'} dx={-OPTION_DX} fan={fan} />
            <FanOption label="Scan" icon="scan" hovered={hover === 'scan'} dx={OPTION_DX} fan={fan} />
          </View>
        </>
      )}
      {(warm || quick) && (
        <Animated.View
          pointerEvents="none"
          style={[styles.quickBox, { opacity: quickAnim, transform: [{ translateY: quickAnim.interpolate({ inputRange: [0, 1], outputRange: [QUICK_H / 2, 0] }) }, { scale: quickAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}
        >
          <UpkeepScannerView
            style={StyleSheet.absoluteFill}
            active={(warm || quick) && app.active}
            // Look for the card more often; the hold-still check stays.
            fastDetection
            onCardRead={onQuickRead}
            onScannerError={e => setQuickHint(e.nativeEvent.message)}
          />
          <Text style={styles.quickHint}>{quickHint}</Text>
        </Animated.View>
      )}
      <Animated.View ref={circle} style={[styles.scanCircle, { transform: [{ scale }] }]}>
        <Ionicons name="scan" size={37} color={text.onAccent} />
      </Animated.View>
    </View>
  );
}

function FanOption({ label, icon, hovered, dx, fan }: {
  label: string; icon: keyof typeof Ionicons.glyphMap; hovered: boolean; dx: number; fan: Animated.Value;
}) {
  const styles = useStyles();
  return (
    <Animated.View
      style={[
        styles.optionWrap,
        {
          opacity: fan,
          transform: [
            { translateX: dx },
            { translateY: fan.interpolate({ inputRange: [0, 1], outputRange: [OPTION_DY, -OPTION_DY] }) },
          ],
        },
      ]}
    >
      <View style={[styles.option, hovered && styles.optionHovered]}>
        <Ionicons name={icon} size={22} color={hovered ? text.onAccent : text.primary} />
        <Text style={[type.label, { color: hovered ? text.onAccent : text.primary }]}>{label}</Text>
      </View>
    </Animated.View>
  );
}

function TabBarItem({ width, selected, label, iconName, onPress }: {
  width: number; selected: boolean; label: string; iconName: keyof typeof Ionicons.glyphMap; onPress(): void;
}) {
  const styles = useStyles();
  const pressed = useRef(new Animated.Value(0)).current;
  function onPressIn() { Animated.timing(pressed, { toValue: 1, duration: 80, useNativeDriver: true }).start(); }
  function onPressOut() { Animated.timing(pressed, { toValue: 0, duration: 120, useNativeDriver: true }).start(); }

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.item, width > 0 && { flex: 0, width }]}
    >
      <Animated.View style={[styles.itemPressed, { opacity: pressed }]} />
      <Ionicons name={iconName} size={24} color={selected ? text.primary : text.secondary} />
      <Text numberOfLines={1} style={[type.label, { color: selected ? text.primary : text.secondary, marginTop: 2 }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Cross-fades a tab's screen content on focus change — 120ms fade out /
 * 180ms fade in, per the design spec. React Navigation keeps every tab
 * screen mounted rather than unmounting on switch, so this is what actually
 * produces the transition; wrapping happens at each Tab.Screen's render
 * (see App.tsx), not inside TabBar itself, since TabBar only ever receives
 * the bar's own props, not screen content.
 */
export function ScreenFade({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  const isFocused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { opacity.setValue(isFocused ? 1 : 0); return; }
    Animated.timing(opacity, {
      toValue: isFocused ? 1 : 0,
      duration: isFocused ? 180 : 120,
      useNativeDriver: true,
    }).start();
  }, [isFocused, reducedMotion, opacity]);
  return <Animated.View style={[styles.fadeFlex, { opacity }]}>{children}</Animated.View>;
}

const useStyles = makeStyles(() => StyleSheet.create({
  bar: { flexDirection: 'row' },
  background: {
    position: 'absolute',
    top: PROTRUDE,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: surface.raised,
    borderTopWidth: 1,
    borderTopColor: border.hairline,
  },
  item: { flex: 1, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  itemPressed: { position: 'absolute', top: 4, bottom: 4, left: 4, right: 4, borderRadius: radius.md, backgroundColor: surface.sunken },
  // Reaches up into the container's PROTRUDE padding so the whole circle is a
  // touch target, not just the part inside the bar.
  scanItem: { flex: 1, marginTop: -PROTRUDE, height: BAR_HEIGHT + PROTRUDE, alignItems: 'center', justifyContent: 'flex-start' },
  scanCircle: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    borderRadius: SCAN_SIZE / 2,
    backgroundColor: accent.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: brand.ink,
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  // Clip box: from the dome's top down to the bar's top edge, so the dome
  // appears to rise from behind the bar rather than over it.
  domeClip: { position: 'absolute', top: -(DOME_R - SCAN_SIZE / 2), height: DOME_R - SCAN_SIZE / 2 + PROTRUDE, width: DOME_R * 2, overflow: 'hidden' },
  dome: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DOME_R * 2,
    height: DOME_R * 2,
    borderRadius: DOME_R,
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: border.strong,
  },
  // The quick-scan camera: bottom edge just above the bar, centred on the button.
  quickBox: {
    position: 'absolute',
    top: PROTRUDE - 12 - QUICK_H,
    width: QUICK_W,
    height: QUICK_H,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: brand.ink,
    borderWidth: 2,
    borderColor: accent.DEFAULT,
  },
  quickHint: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 8, paddingHorizontal: 10, textAlign: 'center', ...type.label, color: brand.parchment, backgroundColor: 'rgba(31,31,31,0.72)' },
  fanNote: { position: 'absolute', top: -(DOME_R - SCAN_SIZE / 2) - 30, alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.sm, overflow: 'hidden', ...type.label, color: text.primary, backgroundColor: surface.raised },
  // Sits on the circle's centre; each option travels out from there.
  fanLayer: { position: 'absolute', top: 0, left: 0, right: 0, height: SCAN_SIZE, alignItems: 'center' },
  optionWrap: { position: 'absolute', top: (SCAN_SIZE - OPTION) / 2 },
  option: { width: OPTION, height: OPTION, borderRadius: OPTION / 2, alignItems: 'center', justifyContent: 'center', gap: 2 },
  optionHovered: { backgroundColor: accent.DEFAULT },
  fadeFlex: { flex: 1 },
}));
