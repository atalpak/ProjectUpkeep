import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, finishSummary, thumbnailUri, scanBand, validateDraft, type Candidate, type CollectionDraft, type Condition, type ConfirmedScan, type Finish, type Printing, type ScanBand, clipLines, describeCandidates, hintsForLog, printingHints, printingLabel, printingNeedsChoice, rankPrintings, bestGuessPrinting } from '@upkeep/scan-core';
import { logScan, newScanLogId } from '../scanLog';
import { UpkeepScannerView, readText, scannerViewAvailable, visionAvailable, type CardReadEvent, type ScannerViewHandle } from '@upkeep/vision';
import { writer } from '../backend';
import { fetchPrinting, type CardPrinting } from '../cardDetails';
import { useApp, type LastUsedDraft } from '../AppProvider';
import { errorMessage } from '../errors';
import { pendingKey } from '../storage';
import { useMort } from '../mort/controller';
import { MortStage } from '../mort/MortStage';
import { Button, DismissingNotice } from '../components/ui';
import { ScanQuickBar } from '../components/ScanQuickBar';
import { ScanSessionSummary } from './ScanSessionSummary';
import type { TabParamList } from '../navigation';
import { accent, brand, radius, space, surface, text, type as typeTokens } from '../theme';
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
const SCAN_MODE_KEY = 'upkeep-scan-mode';

function cardPrice(card: CardPrinting | undefined, finish: Finish): number | null {
  if (!card) return null;
  return finish === 'foil' ? card.priceUsdFoil ?? card.priceUsd
    : finish === 'etched' ? card.priceUsdEtched ?? card.priceUsd
    : card.priceUsd;
}
const money = (value: number) => `$${value.toFixed(2)}`;

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
  | { kind: 'match'; printing: Printing; candidates: Candidate[]; band: ScanBand; stagedId: string | null; needsPrintingChoice: boolean; languageHint?: string };


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
  const [modeReady, setModeReady] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [pricedCards, setPricedCards] = useState<Record<string, CardPrinting>>({});
  const [staged, setStaged] = useState<StagedCard[]>([]);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
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

  useEffect(() => {
    let alive = true;
    void SecureStore.getItemAsync(SCAN_MODE_KEY).then(saved => {
      if (alive && (saved === 'single' || saved === 'continuous')) setMode(saved);
    }).catch(() => {}).finally(() => { if (alive) setModeReady(true); });
    return () => { alive = false; };
  }, []);
  function selectMode(next: ScanMode) {
    if (next === mode) return;
    setMode(next);
    setSheet(null);
    outlineFoundRef.current = false;
    setOutlineFound(false);
    cardGone.current = true;
    void SecureStore.setItemAsync(SCAN_MODE_KEY, next).catch(() => {});
  }

  const priceIds = [...new Set([
    ...staged.map(s => s.printing.id),
    ...(sheet?.kind === 'match' ? [sheet.printing.id] : []),
  ])].join(',');
  useEffect(() => {
    if (!priceIds) return;
    let alive = true;
    for (const id of priceIds.split(',')) {
      if (pricedCards[id]) continue;
      void fetchPrinting(id).then(card => {
        if (alive && card) setPricedCards(prev => ({ ...prev, [id]: card }));
      });
    }
    return () => { alive = false; };
  }, [priceIds]);
  const scannedCount = staged.reduce((sum, row) => sum + row.draft.quantity, 0);
  const knownValue = staged.reduce((sum, row) => sum + (cardPrice(pricedCards[row.printing.id], row.draft.finish) ?? 0) * row.draft.quantity, 0);
  const pricedCount = staged.reduce((sum, row) => sum + (cardPrice(pricedCards[row.printing.id], row.draft.finish) == null ? 0 : row.draft.quantity), 0);
  const lastScannedRow = staged.find(row => row.id === lastScannedId) ?? staged[0] ?? null;
  const canToggleLastFoil = !!lastScannedRow && lastScannedRow.printing.finishes.includes('foil') && lastScannedRow.printing.finishes.includes('nonfoil');

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

  const scannerActive = modeReady && !!permission?.granted && isFocused && !suspended && app.active
    && !app.catalogLoading && !app.disabled && !sessionReviewOpen && !pickerOpen && !app.review;

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
   * available finish) and the remembered condition/destination.
   *
   * `languageHint` (backlog item 8 step 4) is the footer's own printed-language
   * token, when the read had one. It sits between the person's own explicit
   * quick-scan setting and the passive last-used default: `quickLanguage` is a
   * choice someone made on purpose for scans right now and always wins, but
   * `app.lastUsedDraft?.language` is just whatever the PREVIOUS card happened
   * to be -- stale for THIS card the moment the footer says otherwise. So the
   * footer hint outranks the stale default but never overrides an explicit
   * setting, consistent with printing.ts's "the person can always overrule
   * both" design for the footer-based printing guess. */
  function stageFromCapture(printing: Printing, band: ScanBand, languageHint?: string): string | null {
    const finish: Finish = printing.finishes.includes('nonfoil') ? 'nonfoil' : printing.finishes[0]!;
    const condition: Condition = app.lastUsedDraft?.condition ?? CONDITIONS[0];
    const language = quickLanguage ?? languageHint ?? app.lastUsedDraft?.language ?? LANGUAGES[0];
    const location_id = app.lastUsedDraft?.location_id ?? null;
    try {
      const draft = validateDraft({ card_id: printing.id, finish, condition, language, quantity: quickQuantity, location_id, notes: null }, printing);
      const id = stageCard(printing, draft, band);
      setLastScannedId(id);
      return id;
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
    if (!scannerActive || pickerOpen) return;
    const { title, lines, printingLines, source } = event.nativeEvent;
    // A continuous read already in flight can finish just after switching modes.
    if (mode === 'single' && source !== 'guide') return;
    const result = pipeline.matchEvidence({ lines, printingLines });
    const scoped = lockedSetCode
      ? (() => { const filtered = result.candidates.filter(c => c.printing.setCode === lockedSetCode); return filtered.length ? filtered : result.candidates; })()
      : result.candidates;
    const band = scanBand(scoped);
    // Scan diagnostics (Settings): describes this read, changes nothing about it. Only built when the switch is on.
    const recordRead = (suggested?: Printing, requiresChoice = false) => logScan(() => {
      const top = scoped[0];
      const hints = printingHints(printingLines, app.index.setCodes);
      return {
        id: newScanLogId(), at: Date.now(), source: source === 'guide' ? 'scan/guide' : 'scan/outline', title: title ?? '',
        printingLines: clipLines(printingLines), hints: hintsForLog(hints),
        match: band === 'none' ? 'no match' : `band ${band}; top ${top!.printing.name} score ${top!.score.toFixed(2)} ${top!.evidence}${lockedSetCode ? `; set lock ${lockedSetCode}` : ''}; ${mode} mode${requiresChoice ? '; printing should be reviewed' : ''}`,
        candidates: describeCandidates(scoped), guess: suggested ? { printing: printingLabel(suggested), why: requiresChoice ? 'staged as best guess; review the printing' : "resolved from footer evidence or the card's only catalog printing" } : null,
        artPlanned: null, ...(suggested ? { suggestedPrinting: printingLabel(suggested) } : {}),
      };
    });
    if (band === 'none') {
      recordRead();
      // Quiet: an unreadable frame is the common case, not an error. No
      // message, no Mort reaction, nothing staged.
      setSheet({ kind: 'unreadable' });
      return;
    }
    const allPrintings = app.index.printingsOf(scoped[0]!.printing.oracleId);
    const ranking = rankPrintings(allPrintings, printingHints(printingLines, app.index.setCodes));
    const resolvedPrinting = bestGuessPrinting(ranking);
    const conflictsWithLock = !!resolvedPrinting && !!lockedSetCode && resolvedPrinting.setCode !== lockedSetCode;
    const printing = (!conflictsWithLock && resolvedPrinting) || scoped[0]!.printing;
    setLastScannedSetCode(printing.setCode);
    mort.react(band === 'confident' ? 'scan_success' : 'scan_uncertain');
    // Both modes stage the read immediately. An uncertain printing stays
    // editable in the result sheet and session review.
    const needsPrintingChoice = printingNeedsChoice(ranking) || conflictsWithLock;
    recordRead(printing, needsPrintingChoice);
    const stagedId = stageFromCapture(printing, band, result.languageHint);
    setSheet({ kind: 'match', printing, candidates: scoped, band, stagedId, needsPrintingChoice, languageHint: result.languageHint });
  }

  // The last card read has physically left the frame (the native gate saw it
  // absent for ~0.8s). Until this is true, an outline that flickers off and on
  // is the SAME card, so its match must stay on screen rather than flash back
  // to "reading" for a card that will never be read again.
  const cardGone = useRef(true);
  function onCardLost() {
    if (mode === 'single') return;
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
    if (mode === 'single') return;
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

  /** Toggles the last staged card when this printing offers both finishes. */
  function toggleFoil(id: string) {
    patchStagedRow(id, row => {
      const next: Finish = row.draft.finish === 'foil' ? 'nonfoil' : 'foil';
      if (!row.printing.finishes.includes(next)) throw new Error(`This printing is ${row.draft.finish} only.`);
      return { ...row, draft: validateDraft({ ...row.draft, finish: next }, row.printing) };
    });
  }

  /** Another copy of the card the sheet is showing. */
  function addAnotherCopy(id: string) {
    patchStagedRow(id, row => ({ ...row, draft: { ...row.draft, quantity: row.draft.quantity + 1 } }));
  }

  /** Swaps the staged row onto a different printing of the same card. The
   * finish has to be re-chosen with it: an etched-only promo cannot carry a
   * nonfoil draft across. */
  function choosePrinting(printing: Printing) {
    setPickerOpen(false);
    if (sheet?.kind !== 'match') return;
    setSheet({ ...sheet, printing, needsPrintingChoice: false });
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
    if (id === lastScannedId) setLastScannedId(null);
    setSheet(prev => (prev?.kind === 'match' && prev.stagedId === id ? null : prev));
  }

  function clearStaged() {
    updateStaged(() => []);
    setLastScannedId(null);
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

  if (app.catalogLoading) {
    return (
      <View style={styles.panel}>
        <MortStage size="M" />
        <Text style={styles.panelTitle}>Preparing card database</Text>
        <Text style={styles.panelBody}>You can browse your collection while scanning gets ready.</Text>
      </View>
    );
  }

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
        key={mode}
        ref={scanner}
        style={StyleSheet.absoluteFill}
        active={scannerActive}
        manualCaptureOnly={mode === 'single'}
        torchEnabled={torchEnabled}
        onCardRead={onCardRead}
        onOutlineChange={onOutlineChange}
        onCardLost={onCardLost}
        onScannerError={e => app.setMessage(e.nativeEvent.message)}
      />

      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <IconButton label="Back to your collection" name="arrow-back" onPress={() => navigation.navigate('Collection')} />
        <View style={styles.modeRow}>
          <ModeGlyph label="Single card mode" title="Single" icon="filter-1" selected={mode === 'single'} onPress={() => selectMode('single')} />
          <ModeGlyph label="Continuous scanning mode" title="Continuous" icon="playlist-add" selected={mode === 'continuous'} onPress={() => selectMode('continuous')} />
        </View>
        <View style={styles.badgeWrap}>
          <IconButton label={`Review scanned cards, ${scannedCount} copies`} name="albums-outline" onPress={() => setSessionReviewOpen(true)} />
          {scannedCount > 0 && <View pointerEvents="none" style={styles.badge}><Text style={styles.badgeCount}>{scannedCount}</Text></View>}
        </View>
      </View>
      <View style={[styles.utilityRow, { top: insets.top + 62 }]}>
        <View style={styles.totalBox}>
          <Text style={styles.totalPrice}>{pricedCount || scannedCount === 0 ? money(knownValue) : '—'}</Text>
          <Text style={styles.totalLabel}>{pricedCount === scannedCount ? `${scannedCount} scanned` : pricedCount ? `Known value · ${scannedCount} scanned` : `${scannedCount} scanned · value unavailable`}</Text>
        </View>
        <View style={styles.utilityButtons}>
        <IconButton label={torchEnabled ? 'Turn flashlight off' : 'Turn flashlight on'} name={torchEnabled ? 'flash' : 'flash-outline'} onPress={() => setTorchEnabled(v => !v)} />
        <IconButton label="Scan settings" name="settings-outline" onPress={() => setSettingsOpen(v => !v)} />
        </View>
      </View>

      {/* The app shell's banner is hidden while the live view is up (see
          App.tsx), so a message has to surface here or nowhere. */}
      {!!app.message && (
        <Pressable style={[styles.banner, { top: insets.top + 120 }]} onPress={() => app.setMessage('')}>
          <DismissingNotice style={styles.bannerText} onDone={() => app.setMessage('')}>{app.message}</DismissingNotice>
        </Pressable>
      )}

      {settingsOpen && (
        // Capped above the result sheet and scrollable: the language chips wrap to
        // as many rows as the width needs, and on a short phone (or landscape) an
        // uncapped panel ran down behind the sheet with nothing to scroll it into reach.
        <View style={[styles.settings, { top: insets.top + 116, maxHeight: Math.max(160, windowHeight - (insets.top + 116) - (SHEET_RESERVE + insets.bottom)) }]}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Scan settings</Text>
            <IconButton label="Close scan settings" name="close" onPress={() => setSettingsOpen(false)} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
          <ScanQuickBar
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
          price={cardPrice(pricedCards[sheet.kind === 'match' ? sheet.printing.id : ''], stagedRow?.draft.finish ?? 'nonfoil')}
          bottomInset={insets.bottom}
          onOpenPicker={() => setPickerOpen(true)}
        />
      )}
      <View style={[styles.bottomArea, { bottom: insets.bottom + space.sm }]}>
        {!sheet && !outlineFound && <Text style={styles.bottomHint}>Fit one card inside the gold corners</Text>}
        <View style={styles.bottomControls}>
          {(mode === 'single' || !outlineFound || readingStale || sheet?.kind === 'unreadable') ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Capture card" style={styles.captureButton} onPress={() => {
              setSheet({ kind: 'reading' });
              setReadingEpoch(e => e + 1);
              void scanner.current?.captureNow();
            }}>
              <Ionicons name="camera-outline" size={19} color={text.onAccent} />
              <Text style={styles.captureText}>Capture</Text>
            </Pressable>
          ) : <View style={styles.autoLabel}><Ionicons name="scan-outline" size={18} color={brand.parchment} /><Text style={styles.autoText}>Auto scan</Text></View>}
          <Pressable accessibilityRole="button" accessibilityLabel={lastScannedRow?.draft.finish === 'foil' ? `Remove foil from ${lastScannedRow.printing.name}` : `Make ${lastScannedRow?.printing.name ?? 'last card'} foil`} accessibilityState={{ disabled: !canToggleLastFoil, selected: lastScannedRow?.draft.finish === 'foil' }} disabled={!canToggleLastFoil} style={[styles.bottomAction, lastScannedRow?.draft.finish === 'foil' && styles.bottomActionOn, !canToggleLastFoil && styles.disabledAction]} onPress={() => { if (lastScannedRow) toggleFoil(lastScannedRow.id); }}>
            <Image source={require('../assets/foil-f.png')} style={styles.foilGlyph} />
            <Text style={styles.bottomActionText}>Foil</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Add another copy of ${lastScannedRow?.printing.name ?? 'last card'}`} accessibilityState={{ disabled: !lastScannedRow }} disabled={!lastScannedRow} style={[styles.bottomAction, !lastScannedRow && styles.disabledAction]} onPress={() => { if (lastScannedRow) addAnotherCopy(lastScannedRow.id); }}>
            <Ionicons name="add" size={22} color={brand.parchment} />
            <Text style={styles.bottomActionText}>+1</Text>
          </Pressable>
        </View>
      </View>
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

function ModeGlyph({ label, title, icon, selected, onPress }: {
  label: string; title: string; icon: keyof typeof MaterialIcons.glyphMap; selected: boolean; onPress(): void;
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
      <MaterialIcons name={icon} size={19} color={selected ? accent.DEFAULT : brand.parchment} />
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{title}</Text>
    </Pressable>
  );
}

/**
 * The result sheet: thumbnail, status, card name, printing and price.
 * It stays on screen after the card leaves the frame (the original did too),
 * so the printing picker and the foil toggle remain reachable for the card
 * just scanned rather than vanishing with it.
 */
function ResultSheet({ sheet, stale, row, price, bottomInset, onOpenPicker }: {
  sheet: SheetState; stale: boolean; row: StagedCard | null; price: number | null; bottomInset: number;
  onOpenPicker(): void;
}) {
  const styles = useStyles();
  const position = { bottom: bottomInset + 76 };
  if (sheet.kind === 'reading') {
    return (
      <View style={[styles.sheet, position]}>
        <View style={styles.resultCard}>
          <View style={styles.thumbPlaceholder} />
          <View style={styles.sheetBody}>
            <Text style={styles.sheetStatus}>READING CARD</Text>
            <Text style={styles.sheetName}>{stale ? 'Hold it steady, or tap Capture' : 'Hold it steady…'}</Text>
          </View>
        </View>
      </View>
    );
  }
  if (sheet.kind === 'unreadable') {
    return (
      <View style={[styles.sheet, position]}>
        <View style={styles.resultCard}>
          <View style={styles.thumbPlaceholder} />
          <View style={styles.sheetBody}>
            <Text style={styles.sheetNote}>Couldn&apos;t read that one — try again or tap Capture.</Text>
          </View>
        </View>
      </View>
    );
  }

  const { printing, band } = sheet;
  const status = sheet.needsPrintingChoice ? 'SCANNED · CHECK PRINTING' : band === 'confident' ? 'SCANNED' : 'SCANNED · REVIEW MATCH';
  const rarityColor = printing.rarity === 'mythic' ? '#E67342' : printing.rarity === 'rare' ? '#D7B65B' : printing.rarity === 'uncommon' ? '#B8BEC6' : '#D9D1C2';

  return (
    <View style={[styles.sheet, position]}>
      <View style={styles.resultCard}>
        {printing.imageUri
          ? <Image source={{ uri: printing.imageUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
          : <View style={styles.thumbPlaceholder} />}
        <Pressable accessibilityRole="button" accessibilityLabel={`${printing.name}. Tap to select a different printing.`} style={styles.sheetBody} onPress={onOpenPicker}>
          <Text style={styles.sheetStatus} numberOfLines={1}>{status}</Text>
          <Text style={styles.sheetName} numberOfLines={2}>{printing.name}</Text>
          <View style={styles.setLine}>
            <Ionicons name="layers-outline" size={13} color={rarityColor} />
            <Text style={[styles.setBadge, { color: rarityColor, borderColor: rarityColor }]}>{printing.setCode.toUpperCase()}</Text>
            <Text style={styles.sheetCaption} numberOfLines={1}>#{printing.collectorNumber}{row ? ` · ${row.draft.quantity} ${row.draft.quantity === 1 ? 'copy' : 'copies'}` : ''}</Text>
          </View>
          <Text style={styles.price}>{price == null ? 'Price unavailable' : `Market ${money(price)}`}</Text>
        </Pressable>
        <Ionicons name="chevron-forward" size={20} color={brand.parchment} />
      </View>
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

const SHEET_DARK = 'rgba(34,34,34,0.76)';
// Height the result sheet takes at the bottom, before the safe-area inset: what the
// printing list and the scan settings panel must stay clear of.
const SHEET_RESERVE = 192;
const BAR_DARK = 'rgba(34,34,34,0.65)';

const useStyles = makeStyles(() => StyleSheet.create({
  full: { flex: 1, backgroundColor: brand.ink },
  grow: { flex: 1 },
  panel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, backgroundColor: surface.canvas },
  panelTitle: { color: text.primary, fontSize: 21, textAlign: 'center', fontWeight: '600' },
  panelBody: { color: text.secondary, fontSize: 13, textAlign: 'center' },

  topBar: { position: 'absolute', left: space.md, right: space.md, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: BAR_DARK, borderRadius: radius.md, paddingHorizontal: space.xs },
  utilityRow: { position: 'absolute', left: space.md, right: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  utilityButtons: { flexDirection: 'row', backgroundColor: BAR_DARK, borderRadius: radius.md, paddingHorizontal: space.xs },
  totalBox: { minHeight: 48, flex: 1, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: BAR_DARK, borderRadius: radius.md },
  totalPrice: { color: brand.parchment, fontSize: 20, fontWeight: '800' },
  totalLabel: { color: brand.bone, fontSize: 10 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badgeWrap: { width: 44, height: 44 },
  badge: { position: 'absolute', top: 0, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: accent.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  badgeCount: { color: brand.ink, fontSize: 11, fontWeight: '800' },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 2 },
  modeGlyph: { minWidth: 88, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.sm },
  modeGlyphSelected: { backgroundColor: 'rgba(201,163,74,0.26)' },
  modeText: { color: brand.parchment, fontSize: 11, fontWeight: '700' },
  modeTextSelected: { color: accent.DEFAULT },

  banner: { position: 'absolute', left: space.md, right: space.md },
  bannerText: { backgroundColor: surface.raised, borderRadius: radius.md, padding: space.sm, overflow: 'hidden' },
  settings: { position: 'absolute', left: space.md, right: space.md },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: SHEET_DARK, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingLeft: space.md },
  settingsTitle: { color: brand.parchment, fontSize: 15, fontWeight: '700' },

  bottomArea: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center' },
  bottomHint: { color: brand.parchment, fontSize: 12, fontWeight: '600', marginBottom: space.sm, backgroundColor: BAR_DARK, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.sm, overflow: 'hidden' },
  bottomControls: { width: '100%', height: 56, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: BAR_DARK, borderRadius: radius.md, padding: 4 },
  captureButton: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: accent.DEFAULT, borderRadius: radius.sm },
  captureText: { color: text.onAccent, fontSize: 15, fontWeight: '800' },
  autoLabel: { flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  autoText: { color: brand.parchment, fontSize: 13, fontWeight: '700' },
  bottomAction: { height: 48, minWidth: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.sm, paddingHorizontal: 5 },
  bottomActionOn: { backgroundColor: 'rgba(201,163,74,0.24)' },
  disabledAction: { opacity: 0.35 },
  bottomActionText: { color: brand.parchment, fontSize: 12, fontWeight: '700' },
  foilGlyph: { width: 34, height: 34 },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: SHEET_DARK, borderRadius: radius.lg, padding: space.sm },
  thumb: { width: 52, height: 74, borderRadius: radius.sm },
  thumbPlaceholder: { width: 52, height: 74, borderRadius: radius.sm, backgroundColor: 'rgba(245,237,224,0.12)' },
  sheetBody: { flex: 1, justifyContent: 'center', gap: 3 },
  sheetStatus: { color: accent.DEFAULT, fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  sheetName: { color: brand.parchment, fontSize: 14, fontWeight: '800' },
  sheetCaption: { color: brand.bone, fontSize: 11 },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  setBadge: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 4, fontSize: 10, fontWeight: '800' },
  price: { color: brand.parchment, fontSize: 12, fontWeight: '700' },
  sheetNote: { color: brand.bone, fontSize: 13 },

  picker: { position: 'absolute', left: space.md, right: space.md, top: '22%', backgroundColor: SHEET_DARK, borderRadius: radius.lg, padding: space.sm },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.sm },
  pickerTitle: { ...typeTokens.title, flex: 1, color: brand.parchment },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md },
  pickerRowSelected: { backgroundColor: 'rgba(201,163,74,0.20)' },
  pickerThumb: { width: 36, height: 52, borderRadius: radius.sm },
  pickerName: { color: brand.parchment, fontSize: 14, fontWeight: '700' },
  pickerCaption: { color: brand.bone, fontSize: 11 },
}));
