import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { makeStyles } from '../preferences';
import { useRegisterOverlay } from '../overlays';
import { BUILT, MENU_ORDER, PAGES, type PageId } from '../navigation';
import { Badge, IconButton, Tappable } from './ui';
import { accent, border, fontFamily, radius, scrim, space, surface, text, type } from '../theme';

/**
 * Groups `MENU_ORDER`'s twelve destinations under the brief's suggested
 * headings (Priority 6). `MENU_ORDER` does include Scan (it's a real page,
 * just also the tab bar's fixed centre button) so "Primary: Scan, Dashboard"
 * maps directly onto the app's actual page list with nothing dropped or
 * duplicated. `Object.values` here must partition every id in `MENU_ORDER`
 * exactly once — the menu itself just renders each group's ids through the
 * existing per-item Pressable, unchanged.
 */
const MENU_GROUPS: { label: string; pages: PageId[] }[] = [
  { label: 'Primary', pages: ['Scan', 'Dashboard'] },
  { label: 'Library', pages: ['Collection', 'Locations', 'Decks', 'Search', 'Wishlist'] },
  { label: 'Social', pages: ['Friends', 'Trades', 'Notifications'] },
  { label: 'Tools', pages: ['Import', 'Settings'] },
];

if (__DEV__) {
  const grouped = MENU_GROUPS.flatMap(g => g.pages);
  const missing = MENU_ORDER.filter(id => !grouped.includes(id));
  const extra = grouped.filter(id => !MENU_ORDER.includes(id));
  // `.includes()` alone only catches an id being absent, not a real id
  // appearing in two groups at once (it's still `MENU_ORDER.includes(id)`,
  // so `extra` misses it, and every other id can still be present so
  // `missing` misses it too) -- checked separately by position.
  const duplicates = grouped.filter((id, i) => grouped.indexOf(id) !== i);
  if (missing.length || extra.length || duplicates.length) {
    console.warn('[MenuSheet] MENU_GROUPS is out of sync with MENU_ORDER', { missing, extra, duplicates });
  }
}

/**
 * Right-hand slide-in menu listing every page. Stays mounted through the
 * closing animation (`mounted`) and unmounts once it finishes.
 */
export function MenuSheet({ visible, current, onSelect, onClose, unread = 0 }: {
  visible: boolean; current: PageId; onSelect(page: PageId): void; onClose(): void;
  /** Unread notifications, shown as a count on the Notifications entry. */
  unread?: number;
}) {
  useRegisterOverlay(visible);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const panelWidth = Math.min(320, width * 0.85);
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

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
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: progress }]}>
          <Pressable accessibilityLabel="Close menu" style={styles.fill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            { width: panelWidth, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md, paddingRight: space.lg + insets.right },
            { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [panelWidth, 0] }) }] },
          ]}
        >
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Menu</Text>
            <IconButton icon="close" iconSize={24} accessibilityLabel="Close menu" onPress={onClose} style={styles.close} />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {MENU_GROUPS.map(group => (
              <View key={group.label} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {group.pages.map(id => {
                  const page = PAGES[id];
                  const selected = id === current;
                  return (
                    <Tappable
                      key={id}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected }}
                      onPress={() => onSelect(id)}
                      style={[styles.item, selected && styles.itemSelected]}
                    >
                      <Ionicons name={selected ? page.filled : page.outline} size={22} color={text.primary} />
                      <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]}>{page.title}</Text>
                      {!BUILT.has(id) && <Text style={styles.soon}>Soon</Text>}
                      {id === 'Notifications' && unread > 0 && <Badge value={unread > 99 ? '99+' : unread} style={styles.count} />}
                    </Tappable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim },
  fill: { flex: 1 },
  panel: { backgroundColor: surface.canvas, borderLeftWidth: 1, borderLeftColor: border.hairline, paddingHorizontal: space.lg },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm, paddingBottom: space.md },
  panelTitle: { fontFamily: fontFamily.display, fontSize: 22, lineHeight: 28, color: text.primary },
  close: { marginRight: -space.sm },
  list: { gap: space.sm },
  group: { gap: 2 },
  groupLabel: { ...type.label, color: text.secondary, opacity: 0.7, paddingHorizontal: space.md, paddingBottom: 2, textTransform: 'uppercase' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md },
  // `Badge` is sized for an absolute overlay; here it sits inline in the row
  // instead, so it needs its own (slightly larger) minWidth/height rather
  // than the overlay default.
  count: { minWidth: 22, height: 22 },
  itemSelected: { backgroundColor: accent.soft },
  itemLabel: { flex: 1, ...type.body, color: text.primary },
  itemLabelSelected: { fontFamily: fontFamily.bodySemiBold },
  soon: { ...type.label, color: text.secondary },
}));
