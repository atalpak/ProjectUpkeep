import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { accent, border, radius, space, surface, text, type } from '../theme';

// Icon pairs (outline / filled) per route name. Built to comfortably hold a
// 5th slot (Locations, not built tonight — see CLAUDE.md's mobile-app
// decisions memory) without any layout rework: every item is `flex: 1`, so
// adding a route here is the only change a future Locations tab needs.
const ICONS: Record<string, { outline: keyof typeof Ionicons.glyphMap; filled: keyof typeof Ionicons.glyphMap }> = {
  Scan: { outline: 'scan-outline', filled: 'scan' },
  Collection: { outline: 'albums-outline', filled: 'albums' },
  Decks: { outline: 'layers-outline', filled: 'layers' },
  Account: { outline: 'person-circle-outline', filled: 'person-circle' },
};

const PILL_WIDTH = 48;
const PILL_HEIGHT = 28;

/**
 * Presentational tab bar, wired in via `tabBar={props => <TabBar {...props} />}`
 * on the navigator — see App.tsx's header comment for why: React Navigation
 * supplies real screens, back gestures and per-screen scroll position, and
 * this component supplies the exact visual/motion spec the design pass
 * signed off on, rather than the navigator's own default styled bar.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const reducedMotion = useReducedMotion();
  const [barWidth, setBarWidth] = useState(0);
  const itemWidth = barWidth > 0 ? barWidth / state.routes.length : 0;
  const pillX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!itemWidth) return;
    const target = state.index * itemWidth + (itemWidth - PILL_WIDTH) / 2;
    if (reducedMotion) { pillX.setValue(target); return; }
    Animated.timing(pillX, { toValue: target, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [state.index, itemWidth, reducedMotion, pillX]);

  function onLayout(e: LayoutChangeEvent) { setBarWidth(e.nativeEvent.layout.width); }

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.bar, { height: 56 + Math.max(insets.bottom, 8), paddingBottom: Math.max(insets.bottom, 8) }]}
    >
      {itemWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { transform: [{ translateX: pillX }] }]}
        />
      )}
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!;
        const selected = state.index === index;
        const icons = ICONS[route.name];
        const label =
          typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);

        function onPress() {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) navigation.navigate(route.name);
        }

        return (
          <TabBarItem
            key={route.key}
            selected={selected}
            label={label}
            iconName={icons ? (selected ? icons.filled : icons.outline) : 'ellipse-outline'}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

function TabBarItem({ selected, label, iconName, onPress }: {
  selected: boolean; label: string; iconName: keyof typeof Ionicons.glyphMap; onPress(): void;
}) {
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
      style={styles.item}
    >
      <Animated.View style={[styles.itemPressed, { opacity: pressed }]} />
      <Ionicons name={iconName} size={24} color={selected ? text.primary : text.secondary} />
      <Text style={[type.label, { color: selected ? text.primary : text.secondary, marginTop: 2 }]}>{label}</Text>
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: surface.raised,
    borderTopWidth: 1,
    borderTopColor: border.hairline,
  },
  pill: {
    position: 'absolute',
    top: space.sm,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: radius.md + 2,
    backgroundColor: accent.DEFAULT,
  },
  item: {
    flex: 1,
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemPressed: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    right: 4,
    borderRadius: radius.md,
    backgroundColor: surface.sunken,
  },
  fadeFlex: { flex: 1 },
});
