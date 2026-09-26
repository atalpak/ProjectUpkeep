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

// expo-linear-gradient is a native module too, and gets the same treatment as
// DeviceMotion above: an older binary has no `ExpoLinearGradient`, so look for it
// before requiring the JS wrapper. Without it the hue layer falls back to many
// thin slices at reduced opacity (close enough to a gradient to not look striped)
// and the sheen is left out.
type GradientProps = { colors: readonly [string, string, ...string[]]; start?: { x: number; y: number }; end?: { x: number; y: number }; style?: object };
const LinearGradient: React.ComponentType<GradientProps> | null = (() => {
  if (!requireOptionalNativeModule('ExpoLinearGradient')) return null;
  try { return (require('expo-linear-gradient') as { LinearGradient: React.ComponentType<GradientProps> }).LinearGradient; } catch { return null; }
})();

// Pastel foil hues, blended by a continuous gradient rather than banded: the
// first and last stop are fully transparent so the layer has no visible edge.
// [r, g, b, alpha]; `strength` scales alpha (1 = the subtle baseline). Alpha stays
// low on purpose -- the layer should tint the art the way real foil does, never
// paint over it, and hard-edged or saturated colour is what read as fake.
const HUES: [number, number, number, number][] = [
  [255, 170, 200, 0], [255, 170, 200, 0.11], [255, 200, 160, 0.12], [255, 240, 170, 0.11],
  [170, 245, 200, 0.12], [160, 215, 255, 0.12], [200, 180, 255, 0.11], [200, 180, 255, 0],
];
// A wide, soft white band that sweeps with the tilt (peak alpha before `strength`).
const SHEEN_ALPHA = 0.07;
const SHEEN_MAX = 0.12;
// Fallback slices when there is no gradient module, and how much quieter they are.
const SLICES = 24;
const SLICE_DAMPING = 0.6;

const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
/** The hue ramp sampled at t in 0..1, linearly interpolated between stops. */
function hueAt(t: number): [number, number, number, number] {
  const x = t * (HUES.length - 1);
  const i = Math.min(Math.floor(x), HUES.length - 2);
  const f = x - i;
  const [a, b] = [HUES[i], HUES[i + 1]];
  return [0, 1, 2, 3].map(k => a[k] + (b[k] - a[k]) * f) as [number, number, number, number];
}

type Tilt = Animated.ValueXY;

/**
 * The tilt of the phone as a value in -1..1 on each axis, or 0 where there is
 * no motion sensor. One subscription can feed any number of overlays, which is
 * what lets a whole grid of foils shimmer for the price of a single listener.
 * `touching` lets a finger drag take over from the sensor.
 */
export function useFoilTilt(active: boolean, touching?: React.MutableRefObject<boolean>, intervalMs = 33) {
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
      motion.setUpdateInterval(intervalMs);
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
  }, [active, tilt, isTouching, intervalMs]);

  return { tilt, current };
}

/**
 * The holographic layer on its own: a wide diagonal pastel gradient that slides
 * with `tilt`, and a soft white sheen band that sweeps across it. Absolutely
 * fills its parent, so the parent decides the size; `radius` should match the
 * art's corners. `strength` scales the opacity (1 = the quiet baseline; the
 * collection grid uses a little more because its cards are small). Only
 * transforms move, so nothing is re-laid-out per sensor tick.
 */
export function FoilOverlay({ tilt, width, height, radius = 16, strength = 1 }: { tilt: Tilt; width: number; height: number; radius?: number; strength?: number }) {
  const bandShift = tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [width * 0.7, -width * 0.7] });
  const bandLift = tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [height * 0.12, -height * 0.12] });
  const sheenShift = tilt.x.interpolate({ inputRange: [-1, 1], outputRange: [width * 0.9, -width * 0.9] });
  const sheenLift = tilt.y.interpolate({ inputRange: [-1, 1], outputRange: [height * 0.1, -height * 0.1] });
  const bandWidth = width * 2.4;
  const sheenWidth = width * 1.1;
  const layer = { position: 'absolute' as const, top: -height * 0.4, height: height * 1.8 };
  const hues = HUES.map(([r, g, b, a]) => rgba(r, g, b, Math.min(a * strength, 0.4)));
  const sheenPeak = Math.min(SHEEN_ALPHA * strength, SHEEN_MAX);
  const clear = 'rgba(255,255,255,0)';
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Animated.View style={{ ...layer, left: (width - bandWidth) / 2, width: bandWidth, transform: [{ translateX: bandShift }, { translateY: bandLift }, { rotate: '28deg' }] }}>
        {LinearGradient
          ? <LinearGradient colors={hues as unknown as [string, string, ...string[]]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          : <View style={{ flex: 1, flexDirection: 'row' }}>
              {Array.from({ length: SLICES }, (_, i) => {
                const [r, g, b, a] = hueAt((i + 0.5) / SLICES);
                return <View key={i} style={{ flex: 1, backgroundColor: rgba(r, g, b, Math.min(a * strength * SLICE_DAMPING, 0.3)) }} />;
              })}
            </View>}
      </Animated.View>
      {LinearGradient && (
        <Animated.View style={{ ...layer, left: (width - sheenWidth) / 2, width: sheenWidth, transform: [{ translateX: sheenShift }, { translateY: sheenLift }, { rotate: '28deg' }] }}>
          <LinearGradient colors={[clear, `rgba(255,255,255,${(sheenPeak / 2).toFixed(3)})`, `rgba(255,255,255,${sheenPeak.toFixed(3)})`, `rgba(255,255,255,${(sheenPeak / 2).toFixed(3)})`, clear]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * A card image that, when `foil`, carries a subtle holographic sheen that
 * follows how the phone is tilted, and leans a few degrees toward you.
 * Dragging a finger sideways across the card does the same, for a phone with
 * no motion sensor (and the simulator). Costs nothing when `foil` is false.
 */
export function FoilArt({ uri, width, height, foil, strength = 1.4 }: { uri: string | null; width: number; height: number; foil: boolean; strength?: number }) {
  const touching = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const { tilt, current } = useFoilTilt(foil, touching);

  const pan = useMemo(() => {
    // Declared inside the factory: it is only used by the two release handlers
    // below and touches nothing but refs and the useRef'd Animated value, so
    // it needs no dependency of its own.
    function release() {
      touching.current = false;
      current.current = { x: 0, y: 0 };
      // JS driver, like every other write to `tilt` (setValue from the sensor and
      // the drag): mixing in a native-driven animation on the same value is what
      // can leave later JS updates silently not showing.
      Animated.spring(tilt, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 6, tension: 60 }).start();
    }

    return PanResponder.create({
      // Only horizontal drags: vertical ones belong to the sheet's scrolling.
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderGrant: () => { touching.current = true; start.current = { ...current.current }; },
      onPanResponderMove: (_, g) => {
        current.current = { x: clamp(start.current.x + g.dx / (width / 2)), y: current.current.y };
        tilt.setValue(current.current);
      },
      onPanResponderRelease: () => release(),
      onPanResponderTerminate: () => release(),
    });
  }, [width, tilt, current]);

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
