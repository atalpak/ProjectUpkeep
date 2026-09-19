import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useMortReaction, loadPoseAsset, BLINK_CLOSED_ASSET } from './controller';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { mort as mortColors, duration as DURATION } from '../theme';
import { makeStyles } from '../preferences';

// Random gap between blinks, per mort-motion-v1's MOTION_DESIGN.md ("no
// metronomic loop") — closed-frame hold matches its 120ms prototype value.
const BLINK_GAP_MS: [number, number] = [3500, 7000];
const BLINK_CLOSED_MS = 120;

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
 * Renders the real pose art for `idle`/`scan`/`scan_success`/
 * `scan_uncertain`/`file` (mort-motion-v1); every other reaction still falls
 * back to the placeholder circle until its own art lands — no call site of
 * this component needs to change either way.
 */
export function MortStage({ size }: { size: 'S' | 'M' }) {
  const styles = useStyles();
  const reaction = useMortReaction();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const [asset, setAsset] = useState<number | null>(null);
  const [blinkClosed, setBlinkClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPoseAsset(reaction).then(a => { if (!cancelled) setAsset(a); });
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

  // Idle blink — a tiny bit of ambient life on an otherwise static pose, per
  // mort-motion-v1's MOTION_DESIGN.md. Only while genuinely idle: any other
  // reaction owns the face until it falls back to idle on its own.
  useEffect(() => {
    if (reaction !== 'idle' || reducedMotion) { setBlinkClosed(false); return; }
    let cancelled = false;
    let closeTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;
    function scheduleBlink() {
      const [min, max] = BLINK_GAP_MS;
      closeTimer = setTimeout(() => {
        if (cancelled) return;
        setBlinkClosed(true);
        openTimer = setTimeout(() => {
          if (cancelled) return;
          setBlinkClosed(false);
          scheduleBlink();
        }, BLINK_CLOSED_MS);
      }, min + Math.random() * (max - min));
    }
    scheduleBlink();
    return () => { cancelled = true; clearTimeout(closeTimer); clearTimeout(openTimer); };
  }, [reaction, reducedMotion]);

  const dimension = SIZES[size];
  const showBlink = reaction === 'idle' && blinkClosed;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.stage, { width: dimension, height: dimension }]}>
      {asset ? (
        <Animated.Image
          source={showBlink ? BLINK_CLOSED_ASSET : asset}
          resizeMode="contain"
          style={{ width: dimension, height: dimension, opacity }}
        />
      ) : (
        <Animated.View style={[styles.placeholder, { opacity, borderRadius: dimension / 2 }]} />
      )}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  // Mort Green, character-only per theme.ts's own rule — the one place in
  // this app that color is allowed to appear, since it stands in for the
  // character himself rather than any chrome.
  placeholder: { flex: 1, width: '100%', backgroundColor: mortColors.green },
}));
