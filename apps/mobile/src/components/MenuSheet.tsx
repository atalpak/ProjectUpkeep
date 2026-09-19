import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { makeStyles } from '../preferences';
import { BUILT, MENU_ORDER, PAGES, type PageId } from '../navigation';
import { accent, border, fontFamily, radius, scrim, space, surface, text, type } from '../theme';

/**
 * Right-hand slide-in menu listing every page. Stays mounted through the
 * closing animation (`mounted`) and unmounts once it finishes.
 */
export function MenuSheet({ visible, current, onSelect, onClose }: {
  visible: boolean; current: PageId; onSelect(page: PageId): void; onClose(): void;
}) {
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
            { width: panelWidth, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md },
            { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [panelWidth, 0] }) }] },
          ]}
        >
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Menu</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" hitSlop={8} onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={24} color={text.primary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {MENU_ORDER.map(id => {
              const page = PAGES[id];
              const selected = id === current;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(id)}
                  style={[styles.item, selected && styles.itemSelected]}
                >
                  <Ionicons name={selected ? page.filled : page.outline} size={22} color={text.primary} />
                  <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]}>{page.title}</Text>
                  {!BUILT.has(id) && <Text style={styles.soon}>Soon</Text>}
                </Pressable>
              );
            })}
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
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  list: { gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md },
  itemSelected: { backgroundColor: accent.soft },
  itemLabel: { flex: 1, ...type.body, color: text.primary },
  itemLabelSelected: { fontFamily: fontFamily.bodySemiBold },
  soon: { ...type.label, color: text.secondary },
}));
