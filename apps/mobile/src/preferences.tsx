import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { readCollectionSort, type CollectionSort } from '@upkeep/domain';
import { PREFS_KEY } from './storage';
import { applyScheme, type Scheme } from './theme';
import { DEFAULT_SLOTS, PINNABLE, type NavSlots, type PageId } from './navigation';

export type ThemeMode = 'system' | 'light' | 'dark';

export type CollectionView = 'list' | 'grid';

// `welcomeSeen` lives with the other device prefs rather than under its own
// key: it is the same kind of thing (a one-line choice about this phone), and
// "Show the welcome again" in Settings just sets it back to false.
type Prefs = { mode: ThemeMode; slots: NavSlots; collectionView: CollectionView; collectionSort: CollectionSort; welcomeSeen: boolean };

type PreferencesValue = Prefs & {
  scheme: Scheme;
  setMode(mode: ThemeMode): void;
  setCollectionView(view: CollectionView): void;
  setCollectionSort(sort: CollectionSort): void;
  setWelcomeSeen(seen: boolean): void;
  /** Put `page` in slot `index`; if it already sits in another slot the two swap. */
  setSlot(index: number, page: PageId): void;
  resetSlots(): void;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

/** Stored data is untrusted after an app update: keep it only if it is still a
 * valid layout (four distinct, currently pinnable pages). */
function readSlots(value: unknown): NavSlots {
  if (!Array.isArray(value) || value.length !== 4) return DEFAULT_SLOTS;
  const ok = value.every((v): v is PageId => PINNABLE.includes(v as PageId)) && new Set(value).size === 4;
  return ok ? (value as NavSlots) : DEFAULT_SLOTS;
}

function readPrefs(raw: string | null): Prefs {
  const fallback: Prefs = { mode: 'system', slots: DEFAULT_SLOTS, collectionView: 'list', collectionSort: 'name', welcomeSeen: false };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { mode?: unknown; slots?: unknown; collectionView?: unknown; collectionSort?: unknown; welcomeSeen?: unknown };
    const mode: ThemeMode = parsed.mode === 'light' || parsed.mode === 'dark' ? parsed.mode : 'system';
    return { mode, slots: readSlots(parsed.slots), collectionView: parsed.collectionView === 'grid' ? 'grid' : 'list', collectionSort: readCollectionSort(parsed.collectionSort), welcomeSeen: parsed.welcomeSeen === true };
  } catch { return fallback; }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const system = useColorScheme();
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(PREFS_KEY)
      .then(raw => raw, () => null)
      .then(raw => { if (!cancelled) { loaded.current = true; setPrefs(readPrefs(raw)); } });
    return () => { cancelled = true; };
  }, []);

  const scheme: Scheme = (prefs?.mode ?? 'system') === 'system' ? (system === 'dark' ? 'dark' : 'light') : prefs!.mode as Scheme;
  // Synchronously, during render and before any child renders: every reader of
  // the live tokens below this point sees the new scheme.
  applyScheme(scheme);

  const value = useMemo<PreferencesValue | null>(() => {
    if (!prefs) return null;
    function save(next: Prefs) {
      setPrefs(next);
      // Best effort: a failed write just means the choice is forgotten next launch.
      void SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => {});
    }
    return {
      ...prefs,
      scheme,
      setMode: mode => save({ ...prefs, mode }),
      setCollectionView: collectionView => save({ ...prefs, collectionView }),
      setCollectionSort: collectionSort => save({ ...prefs, collectionSort }),
      setWelcomeSeen: welcomeSeen => save({ ...prefs, welcomeSeen }),
      setSlot: (index, page) => {
        const slots = [...prefs.slots] as NavSlots;
        const from = slots.indexOf(page);
        if (from >= 0) slots[from] = slots[index]!;
        slots[index] = page;
        save({ ...prefs, slots });
      },
      resetSlots: () => save({ ...prefs, slots: DEFAULT_SLOTS }),
    };
  }, [prefs, scheme]);

  // Holding the first frame until prefs load avoids a light-mode flash for a
  // dark-mode user; SecureStore answers in a few ms.
  if (!value) return null;
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}

/**
 * Per-scheme StyleSheet cache. The factory reads the live tokens from
 * theme.ts, which `PreferencesProvider` has already switched to the current
 * scheme by the time any component renders, so each scheme's sheet is built
 * exactly once with the right colours. Calling the returned hook also
 * subscribes the component to scheme changes.
 */
export function makeStyles<T extends Record<string, StyleProp<ViewStyle | TextStyle | ImageStyle>>>(factory: () => T): () => T {
  const cache: Partial<Record<Scheme, T>> = {};
  return function useStyles() {
    const { scheme } = usePreferences();
    return (cache[scheme] ??= factory());
  };
}
