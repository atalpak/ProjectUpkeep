import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, finishSummary, thumbnailUri, scanBand, validateDraft, type Candidate, type CollectionDraft, type Condition, type ConfirmedScan, type Finish, type Printing, type ScanBand } from '@upkeep/scan-core';
import { UpkeepScannerView, readText, scannerViewAvailable, visionAvailable, type CardReadEvent, type ScannerViewHandle } from '@upkeep/vision';
import { writer } from '../backend';
import { useApp, type LastUsedDraft } from '../AppProvider';
import { errorMessage } from '../errors';
import { pendingKey } from '../storage';
import { useMort } from '../mort/controller';
import { MortStage } from '../mort/MortStage';
import { Button, DismissingNotice } from '../components/ui';
import { ScanQuickBar } from '../components/ScanQuickBar';
import { ScanSessionSummary } from './ScanSessionSummary';
import type { TabParamList } from '../navigation';
import { accent, brand, radius, space, state as stateColor, surface, text, type as typeTokens } from '../theme';
import { makeStyles } from '../preferences';

/**
 * One row of the staged (not-yet-written) scan session. Groups by stack key
 * (card + finish + condition + language + destination) exactly the way
 * apply_stack_addition merges, so a repeated scan of the same physical card
 * grows one row's quantity instead of listing a duplicate — the local mirror
 * of the same policy, before anything is committed. `id` doubles as the
 * ConfirmScan operationId this row will be saved under: reusing it across
 * every pre-commit edit/retry is what makes a retry of a failed "Add to"
 * attempt idempotent for free (see writer.ts's header) without a second
 * persistence layer for staged state.
 *
 * `attempted` marks a row whose commit already failed once. Its draft is
 * frozen from then on: the server (and ConfirmScan's own payload map) reject
 * a reused operationId carrying a different draft, and the failed attempt may
 * even have landed, so changing the draft under the same id would strand the
 * row, while minting a fresh id could double-add it. New scans of the same
 * card start a separate row instead of merging into an attempted one.
 */
export type StagedCard = { id: string; printing: Printing; draft: CollectionDraft; band: ScanBand; attempted?: boolean };

type ScanMode = 'single' | 'continuous';

/**
 * What the bottom sheet is showing. `reading` is the real window between the
 * native view finding a card edge and its OCR finishing — the original
 * Flutter scanner filled that window with the PREVIOUS card still on screen,
 * which is why its sheet visibly lagged a card behind the outline. This one
 * shows no name until it has read one.
 */
type SheetState =
  | { kind: 'reading' }
  | { kind: 'unreadable' }
  | { kind: 'match'; printing: Printing; candidates: Candidate[]; band: ScanBand; stagedId: string | null };

/**
 * The FOIL tile's purple. Deliberately NOT a theme token: the brand palette
 * has no purple at all, and this one tile is a direct port of the original
 * scanner's foil affordance (which players recognise) rather than a new
 * brand colour that other screens should start reaching for. If foil ever
 * needs a colour anywhere else, that is the moment it becomes a token.
 */
const FOIL_PURPLE = '#584A70';
const FOIL_PURPLE_ON = '#8C79B8';

/**
 * The scan tab. Per the 2026-09-18 rebuild: a live, native card scanner.
 * `UpkeepScannerView` (packages/upkeep-vision) owns the camera, finds the
 * card, draws the gold outline that tracks it, and OCRs one straightened card
 * per physical card — this screen never touches a frame. It receives finished
 * text, matches it against the offline catalog, and stages the result.
 *
 * Nothing reaches the database until the session-review screen's "Add to" is
 * tapped — see commitAll below and ScanSessionSummary.tsx. Manual name search
 * lives there too (the "+" affordance), since a live camera has no room for
 * a search form.
 */
export function ScanScreen() {
  const styles = useStyles();
  const app = useApp();
  const mort = useMort();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const [permission, requestPermission] = useCameraPermissions();
  const [suspended, setSuspended] = useState(false);
  const [mode, setMode] = useState<ScanMode>('continuous');
  const [staged, setStaged] = useState<StagedCard[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [outlineFound, setOutlineFound] = useState(false);
  // Mirrors outlineFound for native event handlers, which can fire before the
  // render that would refresh their closure.
  const outlineFoundRef = useRef(false);
  const [readingStale, setReadingStale] = useState(false);
  const [readingEpoch, setReadingEpoch] = useState(0);
  const [sessionReviewOpen, setSessionReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Defaults the NEXT read uses; they never touch an already-staged row
  // (that's the pencil edit in the session-review screen instead).
  const [quickFinish, setQuickFinish] = useState<Finish | undefined>(undefined);
  const [quickLanguage, setQuickLanguage] = useState<string | undefined>(undefined);
  const [quickQuantity, setQuickQuantity] = useState(1);
  const [lockedSetCode, setLockedSetCode] = useState<string | null>(null);
  const [lastScannedSetCode, setLastScannedSetCode] = useState<string | null>(null);
  const scanner = useRef<ScannerViewHandle | null>(null);
  // Staged rows are mirrored in a ref because a read has to KNOW which row it
  // landed in (the sheet's foil/quantity/printing controls act on that row)
  // and React's queued updater cannot hand that id back synchronously.
  const stagedRef = useRef<StagedCard[]>([]);
  const pipeline = useMemo(() => new ScanPipeline(app.index, { readText }), [app.index]);
  // Scoped to this screen's lifetime, the same way the old continuous mode's
  // confirm was scoped to one session -- see collection.ts's header comment.
  // A batch commit reuses one instance across every staged row's save() call.
  const sessionConfirm = useRef<ConfirmScan | null>(null);

  const stopScanner = useRef(() => setSuspended(true));
  useEffect(() => {
    app.registerCameraStop(stopScanner.current);
    return () => app.registerCameraStop(null);
  }, [app]);
  // AppProvider suspends the camera when the app backgrounds; coming back to
  // the foreground has to lift that, or the scanner stays dark forever.
  useEffect(() => { if (app.active) setSuspended(false); }, [app.active]);
  // A tab navigator keeps every screen mounted rather than unmounting it on
  // switch, so without this the camera sensor would stay open while the user
  // browses Collection/Decks.
  useFocusEffect(useCallback(() => {
    setSuspended(false);
    return () => setSuspended(true);
  }, []));

  // Undetermined permission gets one automatic ask; a definite denial
  // (canAskAgain false) stops asking and leaves the full-screen
  // PermissionState below to offer Settings instead.
  useEffect(() => {
    if (!isFocused || permission?.granted || (permission && !permission.canAskAgain)) return;
    void requestPermission();
  }, [isFocused, permission, requestPermission]);

  const scannerActive = !!permission?.granted && isFocused && !suspended && app.active
    && !app.disabled && !sessionReviewOpen && !app.review;

  // The native lock needs confidence >= 0.70 but the outline draws at less, so
  // a steady low-confidence card would sit on "Reading" forever. After a few
  // seconds say so, and let the manual button be the way out.
  useEffect(() => {
    setReadingStale(false);
    if (sheet?.kind !== 'reading' || !outlineFound) return;
    const timer = setTimeout(() => setReadingStale(true), 3000);
    return () => clearTimeout(timer);
  }, [sheet?.kind, outlineFound, readingEpoch]);

  function updateStaged(change: (prev: StagedCard[]) => StagedCard[]) {
    stagedRef.current = change(stagedRef.current);
    setStaged(stagedRef.current);
  }

  /** Stack key a staged row shares with its stack-mates -- the same identity
   * apply_stack_addition merges on (card, condition, finish, language,
   * destination). Staged rows group by this, not by a fresh id per read, so a
   * repeated scan grows one row's quantity instead of listing a new one. */
  function stackKeyOf(draft: CollectionDraft): string {
    return `${draft.card_id}|${draft.finish}|${draft.condition}|${draft.language}|${draft.location_id ?? ''}`;
  }

  /** Returns the id of the row this card landed in, new or merged-into. */
  function stageCard(printing: Printing, draft: CollectionDraft, band: ScanBand): string {
    const key = stackKeyOf(draft);
    const existing = stagedRef.current.find(s => !s.attempted && stackKeyOf(s.draft) === key);
    if (!existing) {
      const id = Crypto.randomUUID();
      updateStaged(prev => [{ id, printing, draft, band }, ...prev]);
      return id;
    }
    updateStaged(prev => prev.map(s => s.id === existing.id
      ? { ...s, draft: { ...s.draft, quantity: s.draft.quantity + draft.quantity } }
      : s));
    return existing.id;
  }

  /** Builds a fresh read's draft from the settings sheet's finish/language
   * (falling back to the remembered defaults, then the printing's first
   * available finish) and the remembered condition/destination. */
  function stageFromCapture(printing: Printing, band: ScanBand): string | null {
    const finish: Finish = quickFinish && printing.finishes.includes(quickFinish) ? quickFinish
      : app.lastUsedDraft?.finish && printing.finishes.includes(app.lastUsedDraft.finish) ? app.lastUsedDraft.finish
      : printing.finishes[0]!;
    const condition: Condition = app.lastUsedDraft?.condition ?? CONDITIONS[0];
    const language = quickLanguage ?? app.lastUsedDraft?.language ?? LANGUAGES[0];
    const location_id = app.lastUsedDraft?.location_id ?? null;
    try {
      const draft = validateDraft({ card_id: printing.id, finish, condition, language, quantity: quickQuantity, location_id, notes: null }, printing);
      return stageCard(printing, draft, band);
    } catch (e) { app.setMessage(errorMessage(e)); return null; }
  }

  /** Manual "+" add from the session-review screen -- same defaults, always
   * quantity 1 (a search result is a deliberate one-off pick, not a batch of
   * identical copies just scanned). */
  function stageFromSearch(printing: Printing) {
    const finish: Finish = app.lastUsedDraft?.finish && printing.finishes.includes(app.lastUsedDraft.finish) ? app.lastUsedDraft.finish : printing.finishes[0]!;
    const condition: Condition = app.lastUsedDraft?.condition ?? CONDITIONS[0];
    const language = app.lastUsedDraft?.language ?? LANGUAGES[0];
    const location_id = app.lastUsedDraft?.location_id ?? null;
    try {
      const draft = validateDraft({ card_id: printing.id, finish, condition, language, quantity: 1, location_id, notes: null }, printing);
      stageCard(printing, draft, 'confident');
    } catch (e) { app.setMessage(errorMessage(e)); }
  }

  /**
   * One finished read from the native view. There is no capture loop and no
   * same-card suppression here anymore: the native side emits exactly once
   * per physical card (see UpkeepScannerView's release gate), which is what
   * the old JS `lastSeen` check was trying and failing to approximate.
   */
  function onCardRead(event: { nativeEvent: CardReadEvent }) {
    const { lines, printingLines } = event.nativeEvent;
    const result = pipeline.matchEvidence({ lines, printingLines });
    const scoped = lockedSetCode
      ? (() => { const filtered = result.candidates.filter(c => c.printing.setCode === lockedSetCode); return filtered.length ? filtered : result.candidates; })()
      : result.candidates;
    const band = scanBand(scoped);
    if (band === 'none') {
      // Quiet: an unreadable frame is the common case, not an error. No
      // message, no Mort reaction, nothing staged.
      setSheet({ kind: 'unreadable' });
      return;
    }
    const printing = scoped[0]!.printing;
    setLastScannedSetCode(printing.setCode);
    mort.react(band === 'confident' ? 'scan_success' : 'scan_uncertain');
    // Continuous stages immediately and lets the sheet correct it; single
    // shows the match and waits for an explicit Add, which is how the
    // original's single mode worked (its shutter opened a detail screen
    // rather than adding behind the player's back).
    const stagedId = mode === 'continuous' ? stageFromCapture(printing, band) : null;
    setSheet({ kind: 'match', printing, candidates: scoped, band, stagedId });
  }

  // The last card read has physically left the frame (the native gate saw it
  // absent for ~0.8s). Until this is true, an outline that flickers off and on
  // is the SAME card, so its match must stay on screen rather than flash back
  // to "reading" for a card that will never be read again.
  const cardGone = useRef(true);
  function onCardLost() {
    // An outline still up means a new card went down without the frame ever
    // emptying: it is already in view (so not "gone"), and the old match must
    // not stay on screen for the ~300ms until its read lands.
    cardGone.current = !outlineFoundRef.current;
    if (outlineFoundRef.current) {
      setSheet({ kind: 'reading' });
      // The sheet kind may already be 'reading' (previous card stuck), so the
      // stale-hint effect wouldn't re-run on its own: bump an epoch to restart
      // its 3s clock for the new card.
      setReadingEpoch(e => e + 1);
    }
  }

  /** The native view unmounts whenever something else takes over this screen
   * (the session list, a panel), taking its outline with it -- so what it
   * last reported is stale by the time it comes back. */
  function resetLiveState() {
    outlineFoundRef.current = false;
    setOutlineFound(false);
    cardGone.current = true;
    setSheet(prev => (prev?.kind === 'reading' ? null : prev));
  }

  function onOutlineChange(event: { nativeEvent: { found: boolean } }) {
    const found = event.nativeEvent.found;
    outlineFoundRef.current = found;
    setOutlineFound(found);
    if (found) {
      // A new card: drop the previous card's name immediately instead of
      // showing it while the new one is still being read.
      if (cardGone.current) setSheet({ kind: 'reading' });
      cardGone.current = false;
    } else {
      // The outline vanished before locking (moved away, too unsteady): don't
      // leave "reading" up forever waiting for a read that isn't coming.
      setSheet(prev => (prev?.kind === 'reading' ? null : prev));
    }
  }

  /** Single mode's explicit "Add" — stages what the sheet is showing. */
  function addFromSheet() {
    if (sheet?.kind !== 'match' || sheet.stagedId) return;
    const stagedId = stageFromCapture(sheet.printing, sheet.band);
    setSheet({ ...sheet, stagedId });
  }

  function patchStagedRow(id: string, change: (row: StagedCard) => StagedCard) {
    updateStaged(prev => prev.map(s => {
      if (s.id !== id) return s;
      if (s.attempted) {
        app.setMessage('That card already had a failed save attempt. Retry Add to collection as-is, or remove it and add it again.');
        return s;
      }
      try { return change(s); }
      catch (e) { app.setMessage(errorMessage(e)); return s; }
    }));
  }

  /** The FOIL tile. Only offered for a printing that actually has both. */
  function toggleFoil() {
    if (sheet?.kind !== 'match' || !sheet.stagedId) return;
    patchStagedRow(sheet.stagedId, row => {
      const next: Finish = row.draft.finish === 'foil' ? 'nonfoil' : 'foil';
      if (!row.printing.finishes.includes(next)) throw new Error(`This printing is ${row.draft.finish} only.`);
      return { ...row, draft: validateDraft({ ...row.draft, finish: next }, row.printing) };
    });
  }

  /** Another copy of the card the sheet is showing. */
  function addAnotherCopy() {
    if (sheet?.kind !== 'match' || !sheet.stagedId) return;
    patchStagedRow(sheet.stagedId, row => ({ ...row, draft: { ...row.draft, quantity: row.draft.quantity + 1 } }));
  }

  /** Swaps the staged row onto a different printing of the same card. The
   * finish has to be re-chosen with it: an etched-only promo cannot carry a
   * nonfoil draft across. */
  function choosePrinting(printing: Printing) {
    setPickerOpen(false);
    if (sheet?.kind !== 'match') return;
    setSheet({ ...sheet, printing });
    if (!sheet.stagedId) return;
    patchStagedRow(sheet.stagedId, row => {
      const finish: Finish = printing.finishes.includes(row.draft.finish) ? row.draft.finish : printing.finishes[0]!;
      return { ...row, printing, draft: validateDraft({ ...row.draft, card_id: printing.id, finish }, printing) };
    });
  }

  function toggleSetLock() {
    if (lockedSetCode) { setLockedSetCode(null); return; }
    if (lastScannedSetCode) setLockedSetCode(lastScannedSetCode);
  }

  function editStaged(id: string, patch: Partial<CollectionDraft>) {
    patchStagedRow(id, row => ({ ...row, draft: validateDraft({ ...row.draft, ...patch }, row.printing) }));
  }

  /** Session-review's "Change printing…" — the same swap `choosePrinting`
   * does for the live sheet's staged row, but driven by the picker in
   * ScanSessionSummary rather than the camera's own PrintingPicker, and with
   * the finish decided ahead of time (`reconcileFinish`, in that picker)
   * instead of falling back silently to the printing's first finish. */
  function changeStagedPrinting(id: string, printing: Printing, finish: Finish) {
    patchStagedRow(id, row => ({ ...row, printing, draft: validateDraft({ ...row.draft, card_id: printing.id, finish }, printing) }));
  }

  function deleteStaged(id: string) {
    updateStaged(prev => prev.filter(s => s.id !== id));
    setSheet(prev => (prev?.kind === 'match' && prev.stagedId === id ? null : prev));
  }

  function clearStaged() {
    updateStaged(() => []);
    setSheet(null);
  }

  /**
   * The one call every commit goes through -- the exact same confirm.save()
   * a human-confirmed single scan used to call, just run once per staged row
   * inside a batch loop instead of once per tap. Demo mode has no backend to
   * merge into, so it simulates the same "added" bookkeeping locally.
   */
  async function commitOne(item: StagedCard): Promise<void> {
    const lastUsed: LastUsedDraft = { finish: item.draft.finish, condition: item.draft.condition, language: item.draft.language, location_id: item.draft.location_id };
    if (app.demo) {
      app.setLastUsedDraft(lastUsed);
      app.addRecent(`${item.printing.name} · ${item.printing.setCode.toUpperCase()} #${item.printing.collectorNumber}`);
      return;
    }
    if (!writer || !app.userId) throw new Error('Sign in to Upkeep before saving.');
    if (!sessionConfirm.current) sessionConfirm.current = new ConfirmScan(writer);
    const scan: ConfirmedScan = { operationId: item.id, draft: item.draft };
    await sessionConfirm.current.save(scan, item.printing);
    app.setLastUsedDraft(lastUsed);
    app.addRecent(`${item.printing.name} · ${item.printing.setCode.toUpperCase()} #${item.printing.collectorNumber}`);
  }

  /**
   * "Add to" -- commits every staged row. This is app-side staging, not a
   * database transaction: a row is removed from `staged` only once its own
   * save succeeds, so a mid-batch failure (a network blip, say) leaves
   * exactly the rows that didn't make it still staged for a retry tap,
   * rather than losing them or double-adding the ones that already went
   * through. No rollback of the rows that DID succeed -- those are real,
   * correctly-recorded additions and undoing them would be its own risky
   * write, not a safety measure.
   */
  async function commitAll() {
    if (committing || !stagedRef.current.length) return;
    setCommitting(true);
    const batch = stagedRef.current;
    const total = batch.length;
    let succeeded = 0;
    // The summary below replaces app.message, so the real reason a row failed
    // has to be carried into it -- otherwise the user only sees "0 of 1".
    let firstError = '';
    for (const item of batch) {
      try {
        await commitOne(item);
        succeeded += 1;
        updateStaged(prev => prev.filter(s => s.id !== item.id));
      } catch (e) {
        updateStaged(prev => prev.map(s => s.id === item.id ? { ...s, attempted: true } : s));
        if (!firstError) firstError = errorMessage(e);
        console.warn('[scanner] save failed for', item.printing.name, item.printing.setCode, item.printing.collectorNumber, '->', firstError);
      }
    }
    setCommitting(false);
    if (succeeded > 0) mort.react('file');
    if (succeeded === total) {
      setSheet(null);
      app.setMessage(app.demo
        ? `Added ${succeeded} card${succeeded === 1 ? '' : 's'} to this demo session.`
        : `Added ${succeeded} card${succeeded === 1 ? '' : 's'} to your collection.`);
      setSessionReviewOpen(false);
    } else {
      app.setMessage(`Added ${succeeded} of ${total} cards. ${total - succeeded} left to retry.${firstError ? ` Reason: ${firstError}` : ''}`);
    }
  }

  if (app.review) return <RecoveryPanel />;

  if (app.catalogBusy) {
    return (
      <View style={styles.panel}>
        <MortStage size="M" />
        <Text style={styles.panelTitle}>Downloading your card database</Text>
        <Text style={styles.panelBody}>About 40 MB, first launch only. Scanning starts as soon as it finishes.</Text>
      </View>
    );
  }

  // A configured install must never scan against the 3-card demo catalog: it
  // can match nothing real, and demo mode skips the database write entirely.
  // Reaching this means the first-launch download failed (offline, say).
  if (app.demo && writer) {
    return (
      <View style={styles.panel}>
        <MortStage size="M" />
        <Text style={styles.panelTitle}>Card database not downloaded</Text>
        <Text style={styles.panelBody}>Scanning needs your card database (about 40 MB). Connect to the internet and try again.</Text>
        <Button label="Download card database" onPress={() => void app.syncCatalog()} />
      </View>
    );
  }

  if (sessionReviewOpen) {
    return (
      <ScanSessionSummary
        staged={staged}
        locations={app.locations}
        index={app.index}
        committing={committing}
        onEdit={editStaged}
        onChangePrinting={changeStagedPrinting}
        onDelete={deleteStaged}
        onClear={clearStaged}
        onCommit={() => void commitAll()}
        onAddManual={stageFromSearch}
        onScanMore={() => setSessionReviewOpen(false)}
        onMessage={app.setMessage}
      />
    );
  }

  // Live scanning is an iPhone feature for now (owner decision). Everywhere
  // else the session list and its manual "+" add are still fully usable, so
  // this offers them rather than a dead end -- and deliberately does NOT fall
  // back to the old take-a-photo-on-a-timer loop, which never worked.
  if (!scannerViewAvailable) {
    return (
      <View style={styles.panel}>
        <MortStage size="M" />
        <Text style={styles.panelTitle}>Live scanning needs the iPhone app for now</Text>
        <Text style={styles.panelBody}>You can still build this session by name, then add it to your collection.</Text>
        <Button label={`Add cards by name (${staged.length})`} onPress={() => setSessionReviewOpen(true)} />
      </View>
    );
  }

  if (!permission || !permission.granted) {
    return (
      <PermissionState
        deniedForever={!!permission && !permission.canAskAgain}
        disabled={app.disabled}
        onRequest={() => void requestPermission()}
      />
    );
  }

  const stagedRow = sheet?.kind === 'match' && sheet.stagedId
    ? staged.find(s => s.id === sheet.stagedId) ?? null
    : null;

  return (
    <View style={styles.full}>
      <LiveViewPresence onGone={resetLiveState} />
      <UpkeepScannerView
        ref={scanner}
        style={StyleSheet.absoluteFill}
        active={scannerActive}
        onCardRead={onCardRead}
        onOutlineChange={onOutlineChange}
        onCardLost={onCardLost}
        onScannerError={e => app.setMessage(e.nativeEvent.message)}
      />

      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <View style={styles.topRow}>
          <IconButton label="Back to your collection" name="arrow-back" onPress={() => navigation.navigate('Collection')} />
          <Text style={styles.topTitle}>Scan cards</Text>
          <View style={styles.badgeWrap}>
            <IconButton label={`Session list, ${staged.length} cards scanned`} name="list" onPress={() => setSessionReviewOpen(true)} />
            {staged.length > 0 && (
              <View pointerEvents="none" style={styles.badge}><Text style={styles.badgeCount}>{staged.length}</Text></View>
            )}
          </View>
          <IconButton label="Scan settings" name="options-outline" onPress={() => setSettingsOpen(v => !v)} />
        </View>
        <View style={styles.modeRow}>
          <ModeGlyph label="Single card mode" icon="filter-1" selected={mode === 'single'} onPress={() => setMode('single')} />
          <ModeGlyph label="Continuous scanning mode" icon="playlist-add" selected={mode === 'continuous'} onPress={() => setMode('continuous')} />
        </View>
      </View>

      {/* The app shell's banner is hidden while the live view is up (see
          App.tsx), so a message has to surface here or nowhere. */}
      {!!app.message && (
        <Pressable style={[styles.banner, { top: insets.top + 104 }]} onPress={() => app.setMessage('')}>
          <DismissingNotice style={styles.bannerText} onDone={() => app.setMessage('')}>{app.message}</DismissingNotice>
        </Pressable>
      )}

      {settingsOpen && (
        // Capped above the result sheet and scrollable: the language chips wrap to
        // as many rows as the width needs, and on a short phone (or landscape) an
        // uncapped panel ran down behind the sheet with nothing to scroll it into reach.
        <View style={[styles.settings, { top: insets.top + 104, maxHeight: Math.max(160, windowHeight - (insets.top + 104) - (SHEET_RESERVE + insets.bottom)) }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
          <ScanQuickBar
            finish={quickFinish}
            onSelectFinish={setQuickFinish}
            language={quickLanguage}
            onSelectLanguage={setQuickLanguage}
            lockedSetCode={lockedSetCode}
            canLock={!!lastScannedSetCode}
            onToggleLock={toggleSetLock}
            quantity={quickQuantity}
            onChangeQuantity={setQuickQuantity}
          />
          </ScrollView>
        </View>
      )}

      {(!outlineFound || mode === 'single' || readingStale) && (
        <View style={styles.idle} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan the card inside the gold corner marks"
            style={styles.scanPill}
            onPress={() => void scanner.current?.captureNow()}
          >
            <Ionicons name="camera-outline" size={18} color={text.onAccent} />
            <Text style={styles.scanPillText}>Scan card</Text>
          </Pressable>
          {!outlineFound && (
            <>
              <Text style={styles.hint}>Point the camera at one card</Text>
              <Text style={styles.hintSmall}>Fit the card inside the gold corner marks.</Text>
            </>
          )}
        </View>
      )}

      {pickerOpen && sheet?.kind === 'match' && (
        <PrintingPicker
          bottomInset={insets.bottom}
          candidates={sheet.candidates}
          selectedId={sheet.printing.id}
          onChoose={choosePrinting}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {sheet && (
        <ResultSheet
          sheet={sheet}
          stale={readingStale}
          row={stagedRow}
          bottomInset={insets.bottom}
          onOpenPicker={() => setPickerOpen(true)}
          onToggleFoil={toggleFoil}
          onAddAnother={addAnotherCopy}
          onAdd={addFromSheet}
        />
      )}
    </View>
  );
}

/**
 * Rendered only inside the live-camera return. Its mount/unmount IS the signal
 * the shell needs (chrome hidden only while the camera is on screen) and the
 * one ScanScreen needs (reset what the native view last reported), so every
 * other return path -- session list, panels, sign-out -- gets both for free.
 * Layout effect so the chrome is gone before the first paint of the camera.
 */
function LiveViewPresence({ onGone }: { onGone(): void }) {
  const { setScannerLive } = useApp();
  const isFocused = useIsFocused();
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    setScannerLive(isFocused);
    return () => setScannerLive(false);
  }, [isFocused, setScannerLive]);
  useEffect(() => () => gone.current(), []);
  return null;
}

function IconButton({ label, name, onPress }: { label: string; name: keyof typeof Ionicons.glyphMap; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.iconButton} onPress={onPress}>
      <Ionicons name={name} size={24} color={brand.parchment} />
    </Pressable>
  );
}

function ModeGlyph({ label, icon, selected, onPress }: {
  label: string; icon: keyof typeof MaterialIcons.glyphMap; selected: boolean; onPress(): void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.modeGlyph, selected && styles.modeGlyphSelected]}
      onPress={onPress}
    >
      <MaterialIcons name={icon} size={24} color={selected ? accent.DEFAULT : brand.parchment} />
    </Pressable>
  );
}

/**
 * The bottom sheet: thumbnail, status line, card name, and the FOIL tile.
 * It stays on screen after the card leaves the frame (the original did too),
 * so the printing picker and the foil toggle remain reachable for the card
 * just scanned rather than vanishing with it.
 */
function ResultSheet({ sheet, stale, row, bottomInset, onOpenPicker, onToggleFoil, onAddAnother, onAdd }: {
  sheet: SheetState; stale: boolean; row: StagedCard | null; bottomInset: number;
  onOpenPicker(): void; onToggleFoil(): void; onAddAnother(): void; onAdd(): void;
}) {
  const styles = useStyles();
  const padding = { paddingBottom: space.md + bottomInset };
  if (sheet.kind === 'reading') {
    return (
      <View style={[styles.sheet, padding]}>
        <View style={styles.thumbPlaceholder} />
        <View style={styles.sheetBody}>
          <Text style={styles.sheetStatus}>READING CARD</Text>
          <Text style={styles.sheetName}>{stale ? 'Hold it steady, or tap Scan card' : 'Hold it steady…'}</Text>
        </View>
      </View>
    );
  }
  if (sheet.kind === 'unreadable') {
    return (
      <View style={[styles.sheet, padding]}>
        <View style={styles.thumbPlaceholder} />
        <View style={styles.sheetBody}>
          <Text style={styles.sheetNote}>Couldn&apos;t read that one — try again or tap Scan card.</Text>
        </View>
      </View>
    );
  }

  const { printing, band, stagedId } = sheet;
  const foil = row?.draft.finish === 'foil';
  const canFoil = printing.finishes.includes('foil') && printing.finishes.includes('nonfoil');
  const status = band === 'confident' ? 'CARD & PRINTING CONFIRMED' : 'CARD FOUND · CHOOSE PRINTING';

  return (
    <View style={[styles.sheet, padding]}>
      {printing.imageUri
        ? <Image source={{ uri: printing.imageUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
        : <View style={styles.thumbPlaceholder} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${printing.name}. Tap to select a different printing.`}
        style={styles.sheetBody}
        onPress={onOpenPicker}
      >
        <Text style={styles.sheetStatus} numberOfLines={1}>{status}</Text>
        <Text style={styles.sheetName} numberOfLines={1}>{printing.name}</Text>
        <Text style={styles.sheetCaption} numberOfLines={1}>
          {row ? `${printing.setCode.toUpperCase()} #${printing.collectorNumber} · qty ${row.draft.quantity} · tap to change version`
            : 'Tap to select the correct version'}
        </Text>
      </Pressable>
      {stagedId ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add another copy of ${printing.name}`} style={styles.plusTile} onPress={onAddAnother}>
          <Text style={styles.plusText}>+1</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${printing.name} to this session`} style={styles.addTile} onPress={onAdd}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: foil, disabled: !stagedId || !canFoil }}
        accessibilityLabel={foil ? 'Remove the foil tag' : 'Tag this card as foil'}
        disabled={!stagedId || !canFoil}
        style={[styles.foilTile, foil && styles.foilTileOn, (!stagedId || !canFoil) && styles.foilTileOff]}
        onPress={onToggleFoil}
      >
        <Ionicons name={foil ? 'star' : 'star-outline'} size={26} color={brand.parchment} />
        <Text style={styles.foilText}>{foil ? 'FOILED' : 'FOIL'}</Text>
      </Pressable>
    </View>
  );
}

/** Every printing the read matched, so a wrong version can be corrected
 * without leaving the camera. */
function PrintingPicker({ bottomInset, candidates, selectedId, onChoose, onCancel }: {
  bottomInset: number; candidates: Candidate[]; selectedId: string; onChoose(printing: Printing): void; onCancel(): void;
}) {
  const styles = useStyles();
  return (
    // The result sheet is drawn over the picker's bottom edge, so the picker stops above
    // it, including the home-indicator inset the sheet pads its own bottom with.
    <View style={[styles.picker, { bottom: SHEET_RESERVE + bottomInset }]}>
      <View style={styles.pickerHeader}>
        <Text style={styles.pickerTitle}>Choose the printing</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close the printing list" style={styles.iconButton} onPress={onCancel}>
          <Ionicons name="close" size={22} color={brand.parchment} />
        </Pressable>
      </View>
      <ScrollView>
        {candidates.map(c => (
          <Pressable
            key={c.printing.id}
            accessibilityRole="button"
            accessibilityState={{ selected: c.printing.id === selectedId }}
            style={[styles.pickerRow, c.printing.id === selectedId && styles.pickerRowSelected]}
            onPress={() => onChoose(c.printing)}
          >
            {c.printing.imageUri
              ? <Image source={{ uri: thumbnailUri(c.printing.imageUri) ?? c.printing.imageUri }} style={styles.pickerThumb} accessibilityIgnoresInvertColors />
              : <View style={[styles.pickerThumb, styles.thumbPlaceholder]} />}
            <View style={styles.grow}>
              <Text style={styles.pickerName} numberOfLines={1}>{c.printing.name}</Text>
              <Text style={styles.pickerCaption} numberOfLines={1}>
                {c.printing.setName ?? c.printing.setCode.toUpperCase()} · #{c.printing.collectorNumber} · {c.printing.language.toUpperCase()} · {finishSummary(c.printing.finishes)}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PermissionState({ deniedForever, disabled, onRequest }: { deniedForever: boolean; disabled: boolean; onRequest(): void }) {
  const styles = useStyles();
  return (
    <View style={styles.panel}>
      <MortStage size="M" />
      <Text style={styles.panelTitle}>Every card has a place.</Text>
      <Text style={styles.panelBody}>
        {deniedForever
          ? 'Camera access is off. Enable it in Settings to start scanning.'
          : visionAvailable ? 'Turn on camera access to start scanning. Text recognition stays on your phone.' : 'Turn on camera access to start scanning.'}
      </Text>
      {deniedForever
        ? <Button label="Open camera settings" onPress={() => void Linking.openSettings()} />
        : <Button label="Enable camera" disabled={disabled} onPress={onRequest} />}
    </View>
  );
}

/**
 * Recovers a save interrupted mid-request from a build before the 2026-09-17
 * rebuild (the old single-scan ReviewCard persisted a pending write to
 * SecureStore before calling confirm.save() — see AppProvider's recovery
 * effect, which still reads that same key). There is no normal path that sets
 * `app.review` anymore; this exists purely so a leftover pending record from
 * an earlier install doesn't leave the app permanently disabled
 * (`app.disabled` includes `!!review`) with nothing able to clear it.
 */
function RecoveryPanel() {
  const styles = useStyles();
  const app = useApp();
  const [retrying, setRetrying] = useState(false);
  const confirm = useMemo(() => writer ? new ConfirmScan(writer) : null, []);

  async function retry() {
    // AppProvider's recovery effect only ever sets app.review with
    // `submitted` already populated (it read this exact scan back off
    // SecureStore) -- there is no other path into this panel.
    if (!app.review?.submitted || retrying) return;
    setRetrying(true);
    try {
      if (!confirm || !app.userId) throw new Error('Sign in to Upkeep before saving.');
      await confirm.save(app.review.submitted, app.review.printing);
      await SecureStore.deleteItemAsync(pendingKey(app.userId));
      app.setReview(null);
      app.setMessage('Verified — your collection is up to date.');
    } catch (e) { app.setMessage(errorMessage(e)); }
    finally { setRetrying(false); }
  }

  return (
    <View style={styles.panel}>
      <MortStage size="M" />
      <Text style={styles.panelTitle}>Recovering a previous save</Text>
      <Text style={styles.panelBody}>{app.review?.printing.name} was mid-save when this app last closed. Retry to verify whether it reached your collection.</Text>
      <Button label={retrying ? 'Verifying…' : 'Retry / verify save'} disabled={retrying} onPress={() => void retry()} />
    </View>
  );
}

const SHEET_DARK = 'rgba(37,39,38,0.97)';
// Height the result sheet takes at the bottom, before the safe-area inset: what the
// printing list and the scan settings panel must stay clear of.
const SHEET_RESERVE = 110;
const BAR_DARK = 'rgba(31,31,31,0.82)';

const useStyles = makeStyles(() => StyleSheet.create({
  full: { flex: 1, backgroundColor: brand.ink },
  grow: { flex: 1 },
  panel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, backgroundColor: surface.canvas },
  panelTitle: { color: text.primary, fontSize: 21, textAlign: 'center', fontWeight: '600' },
  panelBody: { color: text.secondary, fontSize: 13, textAlign: 'center' },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: BAR_DARK },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, gap: space.xs },
  topTitle: { flex: 1, textAlign: 'center', color: brand.parchment, fontSize: 18, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { width: 44, height: 44 },
  badge: { position: 'absolute', top: 0, right: 0, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: stateColor.error, alignItems: 'center', justifyContent: 'center' },
  badgeCount: { color: brand.parchment, fontSize: 11, fontWeight: '800' },
  modeRow: { flexDirection: 'row', justifyContent: 'center', paddingBottom: space.xs },
  modeGlyph: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  modeGlyphSelected: { backgroundColor: 'rgba(201,163,74,0.18)' },

  banner: { position: 'absolute', left: space.md, right: space.md },
  bannerText: { backgroundColor: surface.raised, borderRadius: radius.md, padding: space.sm, overflow: 'hidden' },
  settings: { position: 'absolute', left: space.md, right: space.md },

  idle: { position: 'absolute', left: 0, right: 0, bottom: 150, alignItems: 'center', gap: space.sm },
  scanPill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: accent.DEFAULT },
  scanPillText: { color: text.onAccent, fontSize: 16, fontWeight: '700' },
  hint: { color: brand.parchment, fontSize: 17, fontWeight: '600', marginTop: space.lg, textAlign: 'center' },
  hintSmall: { color: brand.bone, fontSize: 13, textAlign: 'center' },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.md, backgroundColor: SHEET_DARK },
  thumb: { width: 50, height: 72, borderRadius: radius.sm },
  thumbPlaceholder: { width: 50, height: 72, borderRadius: radius.sm, backgroundColor: 'rgba(245,237,224,0.12)' },
  sheetBody: { flex: 1, justifyContent: 'center', gap: 3 },
  sheetStatus: { color: stateColor.success, fontSize: 10, letterSpacing: 0.8, fontWeight: '800' },
  sheetName: { color: brand.parchment, fontSize: 16, fontWeight: '800' },
  sheetCaption: { color: brand.bone, fontSize: 11 },
  sheetNote: { color: brand.bone, fontSize: 13 },
  plusTile: { minWidth: 44, height: 72, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: 'rgba(245,237,224,0.12)', alignItems: 'center', justifyContent: 'center' },
  plusText: { color: brand.parchment, fontSize: 15, fontWeight: '800' },
  addTile: { minWidth: 56, height: 72, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: accent.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  addText: { color: text.onAccent, fontSize: 15, fontWeight: '800' },
  foilTile: { width: 66, height: 72, borderRadius: radius.md, backgroundColor: FOIL_PURPLE, alignItems: 'center', justifyContent: 'center', gap: 3 },
  foilTileOn: { backgroundColor: FOIL_PURPLE_ON },
  foilTileOff: { opacity: 0.45 },
  foilText: { color: brand.parchment, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },

  picker: { position: 'absolute', left: space.md, right: space.md, top: '22%', backgroundColor: SHEET_DARK, borderRadius: radius.lg, padding: space.sm },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.sm },
  pickerTitle: { ...typeTokens.title, flex: 1, color: brand.parchment },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md },
  pickerRowSelected: { backgroundColor: 'rgba(201,163,74,0.20)' },
  pickerThumb: { width: 36, height: 52, borderRadius: radius.sm },
  pickerName: { color: brand.parchment, fontSize: 14, fontWeight: '700' },
  pickerCaption: { color: brand.bone, fontSize: 11 },
}));
