import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles } from '../preferences';
import { accent, fontFamily, radius, space, text } from '../theme';

const AVATAR = 36;
// The head-and-shoulders region of mort_idle.png (512px square art), in source
// pixels: the crop is what makes him readable at avatar size.
const CROP = { x: 85, y: 10, size: 340 };

/** Mort from the shoulders up, clipped to a circle. */
export function MortAvatar({ size = AVATAR }: { size?: number }) {
  const styles = useStyles();
  const scale = size / CROP.size;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image
        source={require('../mort/assets/mort_idle.png')}
        style={{ position: 'absolute', width: 512 * scale, height: 512 * scale, left: -CROP.x * scale, top: -CROP.y * scale }}
      />
    </View>
  );
}

/** Slim top bar: Mort, the current page's title, and the menu button. */
export function AppHeader({ title, fontsLoaded, onMenu, unread = 0 }: { title: string; fontsLoaded: boolean; onMenu(): void; unread?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.bar}>
      <MortAvatar />
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, !fontsLoaded && styles.titleFallback]}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={unread > 0 ? `Open menu, ${unread} unread notification${unread === 1 ? '' : 's'}` : 'Open menu'} hitSlop={8} onPress={onMenu} style={styles.menuButton}>
        <Ionicons name="menu" size={26} color={text.primary} />
        {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.sm, minHeight: 52 },
  avatar: { overflow: 'hidden', backgroundColor: accent.soft },
  title: { flex: 1, fontFamily: fontFamily.display, fontSize: 22, lineHeight: 28, color: text.primary },
  titleFallback: { fontFamily: undefined, fontWeight: '600' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radius.pill, backgroundColor: accent.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: text.onAccent },
  menuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
}));
