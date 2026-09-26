import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { makeStyles } from '../preferences';
import { Badge, IconButton } from './ui';
import { accent, iconButtonSize, space, surface } from '../theme';

const AVATAR = 42;
// The head-and-shoulders region of mort_idle.png (512px square art), in source
// pixels: the crop is what makes him readable at avatar size.
const CROP = { x: 85, y: 10, size: 340 };
// Both edge regions are this wide, whether or not they hold a button, so Mort
// stays geometrically centered regardless of back-button visibility (brief's
// first acceptance criterion) and every touch target in the bar is >= 44pt --
// the same size `IconButton` (components/ui.tsx) uses by default.
const SIDE = iconButtonSize;

/** Mort from the shoulders up, clipped to a circle, on an accent.soft medallion
 * for contrast in both themes. Decorative only -- never a navigation trigger. */
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

/**
 * The one header every signed-in, non-camera screen shares (see
 * docs/briefs/MOBILE_UI_REFINEMENT_BRIEF.md Priority 1): three fixed regions -- back
 * chevron or reserved empty space on the left, Mort centered, the menu button
 * (with its unread badge) on the right. Page titles no longer live here; they
 * moved into the content area (see PageTitle.tsx) so a screen never shows the
 * same title twice. Native headers are off on every nested stack (App.tsx) --
 * this is the only header the app shows outside the live scanner's own dark
 * camera chrome, which keeps its purpose-built header untouched.
 *
 * `showBack`/`onBack` come from App.tsx's `getHeaderBackInfo`, computed from
 * the navigator's own state rather than passed down screen by screen, so this
 * component stays ignorant of which of the four nested stacks is even active.
 */
export function AppHeader({ onMenu, unread = 0, showBack, onBack }: { onMenu(): void; unread?: number; showBack: boolean; onBack(): void }) {
  const styles = useStyles();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {showBack && (
          <IconButton icon="chevron-back" iconSize={26} accessibilityLabel="Go back" onPress={onBack} />
        )}
      </View>
      <View style={styles.center}>
        <MortAvatar />
      </View>
      <View style={styles.side}>
        <IconButton
          icon="menu"
          iconSize={26}
          accessibilityLabel={unread > 0 ? `Open menu, ${unread} unread notification${unread === 1 ? '' : 's'}` : 'Open menu'}
          onPress={onMenu}
        />
        {unread > 0 && <Badge value={unread > 9 ? '9+' : unread} style={styles.badge} />}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  // Canvas-coloured by default, per the brief -- no border here; a divider
  // once content scrolls under the header is a later refinement, not part of
  // this pass (see docs/briefs/MOBILE_UI_REFINEMENT_BRIEF.md's own "may appear" wording).
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, minHeight: 58, backgroundColor: surface.canvas },
  side: { width: SIDE, height: SIDE, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatar: { overflow: 'hidden', backgroundColor: accent.soft },
  // Positions the shared `Badge` on top of the menu button's `IconButton',
  // matching where the old hand-rolled badge sat.
  badge: { position: 'absolute', top: 6, right: 6 },
}));
