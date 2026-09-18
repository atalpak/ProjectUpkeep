"use client";

import { useSyncExternalStore } from "react";

/**
 * `prefers-reduced-motion: reduce`, kept live rather than read once — a
 * visitor can flip the OS setting without reloading the tab. `useSyncExternalStore`
 * rather than `useState` + `useEffect` so this is safe to call from a Server
 * Component's client boundary without an extra render flicker: the snapshot
 * getter runs during render, and the SSR snapshot below is used verbatim on
 * the server (and on the client until hydration reconciles it).
 *
 * Mirrors `apps/mobile/src/hooks/useReducedMotion.ts` in shape — same "single
 * place this question gets answered" reasoning, different underlying API
 * (`matchMedia` here, `AccessibilityInfo` there).
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// Motion on until proven otherwise — the brief window before hydration plays
// one extra transition at worst, and never blocks anything.
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
