import * as SecureStore from 'expo-secure-store';
import { SCAN_LOG_MAX, patchScanLog, pushScanLog, readScanLog, type ScanLogEntry } from '@upkeep/scan-core';
import { SCAN_LOG_KEY } from './storage';

/**
 * Scan diagnostics: the last ~30 scan reads and the evidence behind each one,
 * kept in memory and mirrored to SecureStore so it survives the app being
 * closed between a scan and the moment the owner looks at it (owner report
 * 2026-09-24: wrong LTR printings with no way to see why).
 *
 * Cost rules, because this sits next to the scan path:
 *  - Off (the default): every entry point returns at once on one boolean, and
 *    callers build their entry inside `if (scanLogEnabled())`, so nothing is
 *    computed, allocated or written.
 *  - On: recording is synchronous memory work only. The SecureStore write is
 *    debounced onto a timer and never awaited, so it cannot delay opening the
 *    card details. A failed read or write is swallowed: diagnostics must never
 *    be able to break a scan.
 *  - Nothing here is read back by the scan path; it only describes what the
 *    scanner did.
 */

let enabled = false;
let entries: ScanLogEntry[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const SAVE_DELAY_MS = 1500;

function emit() { listeners.forEach(l => { try { l(); } catch { /* a listener must not break recording */ } }); }

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void SecureStore.setItemAsync(SCAN_LOG_KEY, JSON.stringify(entries)).catch(() => {});
  }, SAVE_DELAY_MS);
}

export const scanLogEnabled = () => enabled;
export const getScanLog = (): readonly ScanLogEntry[] => entries;

export function subscribeScanLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Loads the stored log once (idempotent), merging under anything already recorded this session. */
export async function loadScanLog(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const stored = readScanLog(await SecureStore.getItemAsync(SCAN_LOG_KEY));
    const ids = new Set(entries.map(e => e.id));
    entries = [...stored.filter(e => !ids.has(e.id)), ...entries].slice(-SCAN_LOG_MAX);
    emit();
  } catch { /* nothing stored, or unreadable: start empty */ }
}

export function setScanLogEnabled(on: boolean) {
  if (enabled === on) return;
  enabled = on;
  if (on) void loadScanLog();
}

/** A fresh id for an entry; unique across launches so a stored entry is never mistaken for a new one. */
export const newScanLogId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function recordScan(entry: ScanLogEntry) {
  if (!enabled) return;
  entries = pushScanLog(entries, entry);
  scheduleSave();
  emit();
}

/** Adds to an entry already recorded (the picture check and the opened printing arrive later). */
export function updateScan(id: string | undefined, patch: Partial<ScanLogEntry>) {
  if (!enabled || !id) return;
  entries = patchScanLog(entries, id, patch);
  scheduleSave();
  emit();
}

export function clearScanLog() {
  entries = [];
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  void SecureStore.deleteItemAsync(SCAN_LOG_KEY).catch(() => {});
  emit();
}
