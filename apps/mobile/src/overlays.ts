import { useEffect, useSyncExternalStore } from 'react';

/**
 * A tiny registry of "a modal or sheet is on screen", so the one-time Scan
 * coach mark (TabBar) can wait its turn: two iOS modals cannot present at
 * once, and a hint appearing over the menu or a card sheet would be both
 * wrong and, if it marked itself seen, lost for good. Modals are portals, so
 * nothing in the React tree says one is open; each sheet reports itself here
 * instead. A module-level counter (not context) because the sheets live in
 * unrelated places -- RootShell, individual screens -- with no shared parent
 * besides the app itself.
 */
let open = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** Call from any modal/sheet with its current visibility. */
export function useRegisterOverlay(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    open += 1; emit();
    return () => { open -= 1; emit(); };
  }, [visible]);
}

/** True while any registered overlay is showing. */
export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => open > 0,
  );
}
