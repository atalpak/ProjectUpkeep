import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * One hook, consumed by both TabBar and the Mort controller, so "does motion
 * play" is answered in exactly one place rather than each animated surface
 * polling AccessibilityInfo itself. Starts `false` (motion on) until the
 * initial async read resolves -- the brief window before that resolves plays
 * one extra transition at worst, never blocks anything.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}
