import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Image, PanResponder, StyleSheet, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// expo-sensors is a native module: an app binary built before it was added has
// no such module, and merely importing it there throws (and shows a red error
// screen in development, caught or not). So look for the native module first
// and only then load the JS wrapper -- and load the DeviceMotion file directly,
// not the package index, which pulls in every other sensor's native module.
// Without it the foil still works by finger and just lacks the tilt.
type MotionReading = {
  // iOS reports attitude in radians (CMAttitude pitch/roll), Android the same unit.
  rotation?: { beta: number; gamma: number } | null;
  // m/s^2 including gravity: a second source for when `rotation` is missing.
  accelerationIncludingGravity?: { x: number; y: number; z: number } | null;
};
type Motion = {
  isAvailableAsync(): Promise<boolean>;
  setUpdateInterval(ms: number): void;
  addListener(cb: (m: MotionReading) => void): { remove(): void };
};
function deviceMotion(): Motion | null {
  if (!requireOptionalNativeModule('ExponentDeviceMotion')) return null;
  try { return (require('expo-sensors/build/DeviceMotion') as { default: Motion }).default; } catch { return null; }
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
// How far (radians, ~12 degrees) the phone has to tip from where it is being
// held for the effect to reach its full travel. 0.45 was too much to ask: a
// hand holding a phone to read a card moves a fraction of that.
const FULL_TILT = 0.22;
// Each sensor tick the reference angle moves this fraction toward the current
// angle (~1.5s time constant at 30Hz), so holding the phone at a new angle
// slowly becomes the new "centre" instead of pinning the effect at an edge.
const BASE_DRIFT = 0.02;
const GRAVITY = 9.80665;

/** Tilt angles (radians) from a reading: attitude if present, else from gravity. */
function anglesOf(m: MotionReading): { beta: number; gamma: number } | null {
  const r = m.rotation;
  if (r && Number.isFinite(r.beta) && Number.isFinite(r.gamma)) return { beta: r.beta, gamma: r.gamma };
  const a = m.accelerationIncludingGravity;
  if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) {
    const c = (v: number) => Math.max(-1, Math.min(1, v / GRAVITY));
    // Direction may be mirrored between platforms; for a shimmer that is harmless.
    return { beta: Math.asin(c(a.y)), gamma: Math.asin(c(a.x)) };
  }
  return null;
}

// Soft rainbow: seven hues at low opacity so it tints the art, never hides it.
// [r, g, b, alpha]; `strength` scales the alpha (1 = the subtle details-page look).
const HUES: [number, number, number, number][] = [[255, 95, 162, 0.11], [255, 179, 107, 0.11], [255, 243, 107, 0.10], [123, 255, 154, 0.10], [107, 215, 255, 0.11], [143, 123, 255, 0.11], [255, 95, 162, 0.11]];
// A soft highlight, faked as stacked circles (no gradients without a native dep).
const GLARE = [1, 0.78, 0.58, 0.4, 0.24];

type Tilt = Animated.ValueXY;

/**
 * The tilt of the phone as a value in -1..1 on each axis, or 0 where there is
 * no motion sensor. One subscription can feed any number of overlays, which is
 * what lets a whole grid of foils shimmer for the price of a single listener.
 * `touching` lets a finger drag take over from the sensor.
 */
export function useFoilTilt(active: boolean, touching?: React.MutableRefObject<boolean>) {
  const tilt = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const current = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const isTouching = touching ?? held;

  useEffect(() => {
    if (!active) return;
    const motion = deviceMotion();
    if (!motion) return;
    let sub: { remove(): void } | null = null;
    let cancelled = false;
    let base: { beta: number; gamma: number } | null = null;
    void motion.isAvailableAsync().then(ok => {
      if (!ok || cancelled) return;
      motion.setUpdateInterval(33);
      sub = motion.addListener(m => {
        const r = anglesOf(m);
        if (!r || isTouching.current) return;
        // Centre on however the phone was held when it started, not on "flat",
        // and let that centre follow the hand slowly.
        if (!base) base = { beta: r.beta, gamma: r.gamma };
        else base = { beta: base.beta + (r.beta - base.beta) * BASE_DRIFT, gamma: base.gamma + (r.gamma - base.gamma) * BASE_DRIFT };
        const tx = clamp((r.gamma - base.gamma) / FULL_TILT);
        const ty = clamp((r.beta - base.beta) / FULL_TILT);
        // Ease toward the target so sensor jitter does not shimmer.
        current.current = { x: current.current.x + (tx - current.current.x) * 0.3, y: current.current.y + (ty - current.current.y) * 0.3 };
        tilt.setValue(current.current);
      });
    }, () => {});
    return () => {
      cancelled = true;
      sub?.remove();
      // Back to rest, so a sheet that reopens (or a view that switches back) does not start skewed.
      current.current = { x: 0, y: 0 };
      tilt.setValue({ x: 0, y: 0 });
    };
  }, [active, tilt, isTouching]);

  return { tilt, current };
}

/**
 * The holographic layer on its own: rainbow bands that slide with `tilt` and a
 * soft highlight that drifts. Absolutely fills its parent, so the parent
 * decides the size; `radius` should match the art's corners. `strength` scales
 * the opacity (1 = subtle; the collection grid uses more because its cards are
 * small).
 */
export function FoilOverlay({ tilt, width, height, radius = 16, strength = 1 }: { tilt: Tilt; width: number; height: number; radius?: number; strength?: number }) {
  const bandShift = tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [width * 0.7, -width * 0.7] });
  const bandLift = tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [height * 0.12, -height * 0.12] });
  const glareX = tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [width * 0.15, width * 0.85] });
  const glareY = tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [height * 0.15, height * 0.65] });
  const bandWidth = width * 2.4;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Animated.View style={{ position: 'absolute', left: (width - bandWidth) / 2, top: -height * 0.4, width: bandWidth, height: height * 1.8, flexDirection: 'row', transform: [{ translateX: bandShift }, { translateY: bandLift }, { rotate: '28deg' }] }}>
        {HUES.map(([r, g, b, a], i) => <View key={i} style={{ flex: 1, backgroundColor: `rgba(${r},${g},${b},${Math.min(a * strength, 0.6).toFixed(3)})` }} />)}
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: glareX }, { translateY: glareY }] }}>
        {GLARE.map((f, i) => {
          const size = width * f;
          return <View key={i} style={{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: `rgba(255,255,255,${Math.min(0.05 * strength, 0.28).toFixed(3)})` }} />;
        })}
      </Animated.View>
    </View>
  );
}

/**
 * A card image that, when `foil`, carries a very subtle holographic sheen that
 * follows how the phone is tilted, and leans a few degrees toward you.
 * Dragging a finger sideways across the card does the same, for a phone with
 * no motion sensor (and the simulator). Costs nothing when `foil` is false.
 */
export function FoilArt({ uri, width, height, foil, strength = 2.4 }: { uri: string | null; width: number; height: number; foil: boolean; strength?: number }) {
  const touching = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const { tilt, current } = useFoilTilt(foil, touching);

  const pan = useMemo(() => PanResponder.create({
    // Only horizontal drags: vertical ones belong to the sheet's scrolling.
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
    onPanResponderGrant: () => { touching.current = true; start.current = { ...current.current }; },
    onPanResponderMove: (_, g) => {
      current.current = { x: clamp(start.current.x + g.dx / (width / 2)), y: current.current.y };
      tilt.setValue(current.current);
    },
    onPanResponderRelease: () => release(),
    onPanResponderTerminate: () => release(),
  }), [width, tilt, current]);

  function release() {
    touching.current = false;
    current.current = { x: 0, y: 0 };
    // JS driver, like every other write to `tilt` (setValue from the sensor and
    // the drag): mixing in a native-driven animation on the same value is what
    // can leave later JS updates silently not showing.
    Animated.spring(tilt, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6, tension: 60 }).start();
  }

  const image = uri
    ? <Image source={{ uri }} style={{ width, height, borderRadius: 16 }} />
    : <View style={{ width, height, borderRadius: 16, backgroundColor: 'rgba(128,128,128,0.2)' }} />;
  if (!foil) return <View style={styles.center}>{image}</View>;

  const rotateY = tilt.x.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const rotateX = tilt.y.interpolate({ inputRange: [-1, 1], outputRange: ['4deg', '-4deg'] });
  return (
    <View style={styles.center} {...pan.panHandlers}>
      <Animated.View style={{ width, height, transform: [{ perspective: 900 }, { rotateY }, { rotateX }] }}>
        {image}
        <FoilOverlay tilt={tilt} width={width} height={height} strength={strength} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignSelf: 'center' } });
