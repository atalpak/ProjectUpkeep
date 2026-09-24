import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { CardIndex, validateDraft, type Condition, type ConfirmedScan, type Finish, type Printing, type StackMoveDraft } from '@upkeep/scan-core';
import { backend, moveWriter } from './backend';
import { demoBundle, installBundledCatalog, loadCatalog, refreshCatalog, type CatalogProgress } from './catalog';
import { checkForUpdate, dismissUpdate, type LatestCatalog, type UpdateCheck } from './catalogUpdates';
import { errorMessage, reportError } from './errors';
import { pendingKey, pendingMoveKey } from './storage';
import { clearScanLog } from './scanLog';

export type Review = { printing: Printing; operationId: string; submitted?: ConfirmedScan };
export type Location = { id: string; name: string; type: string };

/**
 * A move (sleeve/unsleeve) recovered across an app restart the same way a
 * pending scan is — see storage.ts's pendingMoveKey and
 * .claude/rules/mobile.md's "Auth persistence" section, which this reuses
 * rather than inventing a second recovery pattern. `label` is display-only,
 * for the retry banner.
 */
export type PendingMove = { operationId: string; draft: StackMoveDraft; label: string };

/**
 * Finish/condition/language/destination remembered from the last card
 * ReviewCard finished with — see ReviewCard's own comment for the full
 * reasoning (session-only by design, quantity deliberately excluded).
 */
export type LastUsedDraft = { finish: Finish; condition: Condition; language: string; location_id: string | null };

/**
 * App-wide state and effects that used to live in App.tsx's single Scanner
 * component. Everything here is genuinely needed across more than one
 * screen (or gates sign-in/camera/search simultaneously and so cannot become
 * screen-local) — paging, deck loading and picker candidates stay in their
 * own screens instead. See App.tsx's own header comment for why this sits
 * between the loaded fonts and NavigationContainer rather than inside it:
 * the root conditional (no backend / no session / signed in) reads this
 * context to decide what to render, so it has to be available before the
 * navigator exists at all.
 */
type AppContextValue = {
  backendAvailable: boolean;
  userId: string | null;
  active: boolean;
  index: CardIndex;
  setIndex(index: CardIndex): void;
  demo: boolean;
  catalogBusy: boolean;
  /** Progress of the running card-database download, or null when none is running. */
  catalogProgress: CatalogProgress | null;
  /** The last download's failure, until the next attempt or `clearCatalogError`. */
  catalogError: string;
  clearCatalogError(): void;
  /** A newer card database than the one on the phone, when one is waiting to be offered. */
  catalogUpdate: LatestCatalog | null;
  /** Asks the server whether a newer database exists (`force` ignores the once-a-day limit). */
  checkForCatalogUpdate(force?: boolean): Promise<UpdateCheck>;
  /** "Later": stop offering this version. */
  dismissCatalogUpdate(): void;
  /** Downloads the card database (the window in RootShell shows the progress). Resolves true on success. */
  syncCatalog(): Promise<boolean>;
  message: string;
  setMessage(message: string | ((prev: string) => string)): void;
  busy: boolean;
  setBusy(busy: boolean): void;
  recovering: boolean;
  /** busy || recovering || catalogBusy || !!review — the app-wide hard stop
   * that gates sign-in, camera and search inputs simultaneously. Screens may
   * still add their own additional conditions (e.g. a screen-local `saving`
   * flag) on top of this. */
  disabled: boolean;
  review: Review | null;
  setReview(review: Review | null): void;
  locations: Location[];
  lastUsedDraft: LastUsedDraft | null;
  setLastUsedDraft(draft: LastUsedDraft): void;
  recent: string[];
  addRecent(label: string): void;
  pendingMove: PendingMove | null;
  moveBusy: boolean;
  beginMove(draft: StackMoveDraft, label: string): Promise<{ instanceId: string; quantity: number; replayed: boolean }>;
  retryPendingMove(): Promise<void>;
  /**
   * Registers the Scan screen's own stopCamera() so the AppState background
   * handler (and sign-out) can reach it without camera/capture state moving
   * out of ScanScreen. See App.tsx's comment on this for the full reasoning
   * — a ref-based registration, chosen as the less invasive of the two
   * options the spec allows, over threading an abort hook through props.
   */
  registerCameraStop(stop: (() => void) | null): void;
  /**
   * True only while ScanScreen is rendering the live camera view. The app
   * shell hides its header, banners and safe-area insets for exactly that
   * window and no other Scan-tab screen (session list, permission, download
   * panels), which all need them.
   */
  scannerLive: boolean;
  setScannerLive(live: boolean): void;
  /** Re-reads the destination list after a location is created, renamed or deleted. */
  reloadLocations(): Promise<void>;
  signOut(): Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState(() => new CardIndex(demoBundle));
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [lastUsedDraft, setLastUsedDraft] = useState<LastUsedDraft | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogProgress, setCatalogProgress] = useState<CatalogProgress | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogUpdate, setCatalogUpdate] = useState<LatestCatalog | null>(null);
  const updateChecked = useRef(false);
  const [scannerLive, setScannerLive] = useState(false);
  const currentUser = useRef<string | null>(null);
  const alive = useRef(true);
  const cameraStop = useRef<(() => void) | null>(null);
  const demo = index.bundle.version === 'demo-only';

  function registerCameraStop(stop: (() => void) | null) { cameraStop.current = stop; }

  useEffect(() => {
    alive.current = true;
    const loaded = loadCatalog();
    setIndex(loaded);
    // First launch (still on the 3-card demo bundle): unpack the snapshot that
    // ships inside the app, so scanning works with no download. A build without
    // a snapshot, or one that cannot be read, stays on demo, and the signed-in
    // user is asked to download instead (CatalogDownloadModal in App.tsx).
    if (loaded.bundle.version === 'demo-only' && backend) {
      setCatalogBusy(true); setCatalogProgress({ phase: 'preparing' });
      void installBundledCatalog().then(installed => { if (installed && alive.current) setIndex(installed); })
        .finally(() => { if (alive.current) { setCatalogBusy(false); setCatalogProgress(null); } });
    }
    const sub = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      if (state !== 'active') { cameraStop.current?.(); backend?.auth.stopAutoRefresh(); }
      else backend?.auth.startAutoRefresh();
    });
    return () => { alive.current = false; cameraStop.current?.(); sub.remove(); backend?.auth.stopAutoRefresh(); };
  }, []);

  useEffect(() => {
    if (!backend) return;
    const { data } = backend.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      if (currentUser.current === nextUser) return;
      const previousUser = currentUser.current;
      currentUser.current = nextUser;
      cameraStop.current?.();
      setUserId(nextUser); setRecovering(!!nextUser);
      setReview(null); setRecent([]); setLocations([]); setPendingMove(null);
      // Sign-out clears the persisted session (Supabase's own job) but not
      // anything else this app wrote — so a pending scan (and a pending
      // sleeve/unsleeve) must be cleared here, or it would be stranded under
      // an account nobody is signed into anymore and could be picked up by
      // whoever signs in next on this device.
      if (!nextUser && previousUser) {
        void SecureStore.deleteItemAsync(pendingKey(previousUser));
        void SecureStore.deleteItemAsync(pendingMoveKey(previousUser));
        // The scan log is device-level but holds what this person scanned; it must not reach the next account.
        clearScanLog();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Recovers a sleeve/unsleeve interrupted mid-request the same way the
  // effect below recovers a pending scan: surface it and require an explicit
  // retry tap, never an automatic background replay. Kept independent of the
  // scan-recovery effect's busy/recovering flags — a stuck pending move must
  // not block scanning, and vice versa.
  useEffect(() => {
    if (!backend || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(pendingMoveKey(userId));
        if (cancelled || !raw) return;
        const pending = JSON.parse(raw) as PendingMove;
        setPendingMove(pending);
        setMessage(m => m || 'An unfinished sleeve/unsleeve was recovered. Retry to verify whether it went through.');
      } catch (e) {
        reportError(e, 'appProvider.pendingMove');
        // A malformed pending-move record cannot be retried meaningfully;
        // drop it rather than surfacing a retry button that can never work.
        if (!cancelled) void SecureStore.deleteItemAsync(pendingMoveKey(userId));
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!backend || !userId) return;
    let cancelled = false;
    setRecovering(true);
    void (async () => {
      const { error } = await loadLocations(userId);
      if (cancelled) return;
      if (error) setMessage('Locations could not load. Unsorted remains available.');
      try {
        const pending = await SecureStore.getItemAsync(pendingKey(userId));
        if (cancelled || !pending) return;
        const scan = JSON.parse(pending) as ConfirmedScan;
        const printing = index.get(scan.draft.card_id);
        if (!printing) { setMessage('An unfinished save needs its catalog. Refresh the catalog before scanning more cards.'); setBusy(true); return; }
        validateDraft(scan.draft, printing);
        setBusy(false);
        setReview({ printing, operationId: scan.operationId, submitted: scan });
        setMessage('An unfinished save was recovered. Retry to verify whether it reached your collection.');
      } catch { setMessage('The pending save could not be recovered. Keep this installation and contact the developer before adding more cards.'); setBusy(true); }
      finally { if (!cancelled) setRecovering(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, index]);

  // locations.user_id is the owner column (see supabase/migrations/00000000000004_locations.sql --
  // card_instances uses owner_user_id, locations does not). Filtering explicitly, rather than
  // relying on RLS alone, matters here for the same reason it does in src/lib/collection/queries.ts:
  // migration 9 makes a friend's tradable locations legitimately readable, so an unscoped select
  // would mix a friend's binder into this list. Decks are left out: they have their own tab.
  async function loadLocations(forUser: string) {
    if (!backend) return { error: null };
    const { data, error } = await backend.from('locations').select('id,name,type').eq('user_id', forUser).order('name').limit(1000);
    if (!error) setLocations((data ?? []).filter(l => l.type !== 'deck'));
    return { error };
  }
  async function reloadLocations() { if (userId) await loadLocations(userId); }

  async function checkForCatalogUpdate(force = false): Promise<UpdateCheck> {
    const result = await checkForUpdate(index.bundle, force);
    if (result.status === 'available') setCatalogUpdate(result.latest);
    return result;
  }
  function dismissCatalogUpdate() {
    if (catalogUpdate) void dismissUpdate(catalogUpdate.version);
    setCatalogUpdate(null);
  }

  // Once per launch, for a signed-in user who already has the real database:
  // quietly ask whether a newer one exists (itself limited to once a day).
  useEffect(() => {
    if (!backend || !userId || demo || catalogBusy || updateChecked.current) return;
    updateChecked.current = true;
    void checkForCatalogUpdate();
  }, [userId, demo, catalogBusy]);

  async function syncCatalog(): Promise<boolean> {
    if (catalogBusy) return false;
    setCatalogBusy(true); setCatalogError(''); setCatalogProgress({ phase: 'downloading', received: 0, total: null });
    try { setIndex(await refreshCatalog(setCatalogProgress, catalogUpdate?.url)); setCatalogUpdate(null); return true; }
    catch (e) { setCatalogError(errorMessage(e)); return false; }
    finally { setCatalogBusy(false); setCatalogProgress(null); }
  }

  /**
   * Sleeves or unsleeves one decided stack, through apply_stack_move
   * (migration 38) via createMoveWriter (packages/scan-core/src/move.ts).
   * Same persist-before-write shape as a scan save — see the original
   * App.tsx history / ReviewCard.save for the full reasoning.
   */
  async function beginMove(draft: StackMoveDraft, label: string) {
    if (!moveWriter || !userId) throw new Error('Sign in to move cards in your collection.');
    const operationId = Crypto.randomUUID();
    const pending: PendingMove = { operationId, draft, label };
    await SecureStore.setItemAsync(pendingMoveKey(userId), JSON.stringify(pending));
    setPendingMove(pending);
    const result = await moveWriter.move({ operationId, draft });
    await SecureStore.deleteItemAsync(pendingMoveKey(userId));
    setPendingMove(null);
    return result;
  }

  async function retryPendingMove() {
    if (!pendingMove || !moveWriter || !userId || moveBusy) return;
    setMoveBusy(true); setMessage('');
    try {
      await moveWriter.move({ operationId: pendingMove.operationId, draft: pendingMove.draft });
      await SecureStore.deleteItemAsync(pendingMoveKey(userId));
      setPendingMove(null);
      setMessage('Verified — your collection is up to date.');
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setMoveBusy(false); }
  }

  function addRecent(label: string) {
    setRecent(prev => [label, ...prev].slice(0, 20));
  }

  async function signOut() {
    if (!backend) return;
    const { error } = await backend.auth.signOut();
    if (error) setMessage(error.message);
  }

  const disabled = busy || recovering || catalogBusy || !!review;

  const value = useMemo<AppContextValue>(() => ({
    backendAvailable: !!backend,
    userId, active, index, setIndex, demo, catalogBusy, catalogProgress, catalogError, clearCatalogError: () => setCatalogError(''), catalogUpdate, checkForCatalogUpdate, dismissCatalogUpdate, syncCatalog,
    message, setMessage, busy, setBusy, recovering, disabled,
    review, setReview, locations, lastUsedDraft, setLastUsedDraft, recent, addRecent,
    pendingMove, moveBusy, beginMove, retryPendingMove, registerCameraStop, scannerLive, setScannerLive, signOut, reloadLocations,
  }), [userId, active, index, demo, catalogBusy, catalogProgress, catalogError, catalogUpdate, message, busy, recovering, disabled, review, locations, lastUsedDraft, recent, pendingMove, moveBusy, scannerLive]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
