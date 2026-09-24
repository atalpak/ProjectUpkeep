import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SCAN_LOG_MAX, patchScanLog, pushScanLog, readScanLog, type ScanLogEntry } from '@upkeep/scan-core';
import { SCAN_LOG_KEY } from './storage';

/**
 * Scan diagnostics: the last ~30 scan reads and the evidence behind each one,
 * kept in memory and mirrored to SecureStore so it survives the app being
 * closed between a scan and the moment the owner looks at it (owner report
 * 2026-09-24: wrong LTR printings with no way to see why).
 *
 * Rules, because this sits next to the scan path:
 *  - Off (the default): `logScan` / `logUpdate` return on one boolean and never
 *    call their builder, so nothing is computed, allocated or written.
 *  - On: builders run inside try/catch, so a bug in a describer can cost a log
 *    line and never a scan. Recording is synchronous memory work; the
 *    SecureStore write is debounced, never awaited by the scan path, and
 *    flushed when the app leaves the foreground.
 *  - Nothing here is read back by the scan path; it only describes what the
 *    scanner did.
 */

let enabled = false;
let entries: ScanLogEntry[] = [];
let loadPromise: Promise<void> | null = null;
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const SAVE_DELAY_MS = 1500;

function warn(what: string, error: unknown) { if (__DEV__) console.warn(`[scan-log] ${what} failed`, error); }
function emit() { listeners.forEach(l => { try { l(); } catch (e) { warn('listener', e); } }); }

/**
 * Loads the stored log once, merging it UNDER whatever was recorded this session. A failed read is
 * remembered as attempted (so a broken store cannot make every save retry it), but saves always wait
 * for the attempt to finish first: an early save can never overwrite a stored log it has not merged.
 */
export function loadScanLog(): Promise<void> {
  loadPromise ??= (async () => {
    try {
      const stored = readScanLog(await SecureStore.getItemAsync(SCAN_LOG_KEY));
      const ids = new Set(entries.map(e => e.id));
      entries = [...stored.filter(e => !ids.has(e.id)), ...entries].slice(-SCAN_LOG_MAX);
      emit();
    } catch (e) { warn('load', e); }
  })();
  return loadPromise;
}

async function saveNow() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  await loadScanLog();
  try { await SecureStore.setItemAsync(SCAN_LOG_KEY, JSON.stringify(entries)); } catch (e) { warn('save', e); }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveNow(); }, SAVE_DELAY_MS);
}

/** A write still waiting on its timer is not lost when the app is backgrounded (iOS may kill it there). */
AppState.addEventListener('change', s => {
  if (s !== 'active' && saveTimer) { clearTimeout(saveTimer); void saveNow(); }
});

export const scanLogEnabled = () => enabled;
export const getScanLog = (): readonly ScanLogEntry[] => entries;

export function subscribeScanLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setScanLogEnabled(on: boolean) {
  if (enabled === on) return;
  enabled = on;
  if (on) void loadScanLog();
  // Turning it off keeps what was recorded: write any pending change now rather than leaving a timer running.
  else if (saveTimer) { clearTimeout(saveTimer); void saveNow(); }
}

/** A fresh id for an entry; unique across launches so a stored entry is never mistaken for a new one. */
export const newScanLogId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Records one read. `build` only runs when diagnostics are on, and any failure in it or in recording is swallowed. */
export function logScan(build: () => ScanLogEntry) {
  if (!enabled) return;
  try {
    entries = pushScanLog(entries, build());
    scheduleSave();
    emit();
  } catch (e) { warn('record', e); }
}

/** Adds to an entry already recorded (the picture check and the opened printing arrive later). Same guarantees as `logScan`. */
export function logUpdate(id: string | undefined, build: () => Partial<ScanLogEntry>) {
  if (!enabled || !id) return;
  try {
    entries = patchScanLog(entries, id, build());
    scheduleSave();
    emit();
  } catch (e) { warn('update', e); }
}

export function clearScanLog() {
  entries = [];
  dirty = false;
  // Nothing stored is worth merging back in once cleared, so a load still to come must not resurrect it.
  loadPromise = Promise.resolve();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  void SecureStore.deleteItemAsync(SCAN_LOG_KEY).catch(() => {});
  emit();
}
