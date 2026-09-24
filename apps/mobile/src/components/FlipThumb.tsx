import React from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles } from '../preferences';
import { radius } from '../theme';
import { FlipBadge } from './FlipBadge';
import { useCardFace, type FlipSource } from '../hooks/useCardFace';

/**
 * A row's small card picture and the name beside it, as one unit that shares
 * the flip state: pressing the badge swaps the picture and the name together.
 *
 * Renders a fragment (the thumbnail box, then whatever `children` returns), so
 * it drops into a row's existing `flexDirection: 'row'` in place of the old
 * `<Image>` + text pair. `children` receives the name to show: the card's own
 * for a card that cannot flip, the side's for one that can.
 *
 * The box keeps the caller's own `thumb` style (size, background) and lets the
 * badge poke past its edge for a bigger touch target, so the picture is clipped
 * by its own radius rather than by an `overflow: hidden` on the box (which
 * would also clip the touch area).
 */
export function FlipThumb({ card, thumbStyle, children }: {
  card: FlipSource; thumbStyle: StyleProp<ViewStyle>; children(name: string): React.ReactNode;
}) {
  const styles = useStyles();
  const face = useCardFace(card, 'small');
  return (
    <>
      <View style={thumbStyle}>
        {face.image ? <Image source={{ uri: face.image }} onError={face.onImageError} style={styles.image} accessibilityIgnoresInvertColors /> : null}
        {face.canFlip && <FlipBadge onPress={face.flip} otherName={face.otherName} size={22} corner="bottom-right" />}
      </View>
      {children(face.name ?? card.name)}
    </>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  image: { ...StyleSheet.absoluteFillObject, borderRadius: radius.thumb },
}));
