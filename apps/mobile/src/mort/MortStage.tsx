import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useMortReaction, loadPoseAsset } from './controller';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { mort as mortColors, duration as DURATION } from '../theme';

// S = scan results (found it / uncertain / filed), M = the idle empty state.
// See the design spec's responsive modes (brand doc §26) — this app only
// needs the two smallest tiers today.
const SIZES: Record<'S' | 'M', number> = { S: 88, M: 140 };

/**
 * The visual half of the Mort semantic-reaction system (see ./controller.ts
 * for the "why" of the split). Decorative only: `accessible={false}` +
 * `importantForAccessibility="no-hide-descendants"` because Mort is never
 * the sole carrier of information — the real copy sits alongside him, per
 * the brand doc's accessibility rules (§25).
 *
 * Renders a plain placeholder circle today because Mort art assets do not
 * exist yet — `loadPoseAsset` is already wired to swap in a real pose once
 * they do, with no change needed at any call site of this component.
 */
export function MortStage({ size }: { size: 'S' | 'M' }) {
  const reaction = useMortReaction();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const [, setAsset] = useState<unknown | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPoseAsset(reaction).then(asset => { if (!cancelled) setAsset(asset); });
    if (reducedMotion) {
      // Instant pose swap, no cross-fade, per the reduced-motion rules both
      // the design spec and the brand doc (§25) call for.
      opacity.setValue(1);
    } else {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: DURATION.micro, useNativeDriver: true }).start();
    }
    return () => { cancelled = true; };
  }, [reaction, reducedMotion, opacity]);

  const dimension = SIZES[size];
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.stage, { width: dimension, height: dimension }]}>
      <Animated.View style={[styles.placeholder, { opacity, borderRadius: dimension / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  // Mort Green, character-only per theme.ts's own rule — the one place in
  // this app that color is allowed to appear, since it stands in for the
  // character himself rather than any chrome.
  placeholder: { flex: 1, width: '100%', backgroundColor: mortColors.green },
});
