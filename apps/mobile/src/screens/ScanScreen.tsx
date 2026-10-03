import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { SvgUri } from 'react-native-svg';
import { useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, scanBand, validateDraft, type CollectionDraft, type Condition, type ConfirmedScan, type Finish, type Printing, type ScanBand, clipLines, describeCandidates, hintsForLog, printingHints, printingLabel, printingNeedsChoice, rankPrintings, bestGuessPrinting } from '@upkeep/scan-core';
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
import { CardDetails } from '../components/CardDetails';
import { ScanSessionSummary } from './ScanSessionSummary';
import { candidatesInLockedSet } from '../scanSetLock';
import { accent, brand, radius, space, surface, text } from '../theme';
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
  | { kind: 'match'; printing: Printing; band: ScanBand; stagedId: string | null; needsPrintingChoice: boolean };


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
  const [pendingRead, setPendingRead] = useState(false);
  const [readingEpoch, setReadingEpoch] = useState(0);
  const [sessionReviewOpen, setSessionReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<{ rowId: string; name: string; printingId: string; printingCheck?: { required: boolean } } | null>(null);
  const [committing, setCommitting] = useState(false);
  // Defaults the NEXT read uses; they never touch an already-staged row
  // (that's the pencil edit in the session-review screen instead).
  const [quickLanguage, setQuickLanguage] = useState<string | undefined>(undefined);
  const [quickQuantity, setQuickQuantity] = useState(1);
  const [lockedSetCode, setLockedSetCode] = useState<string | null>(null);
  const scanner = useRef<ScannerViewHandle | null>(null);
  // Staged rows are mirrored in a ref because a read has to KNOW which row it
  // landed in (the sheet's foil/quantity/printing controls act on that row)
  // and React's queued updater cannot hand that id back synchronously.
  const stagedRef = useRef<StagedCard[]>([]);
  const pipeline = useMemo(() => new ScanPipeline(app.index, { readText }), [app.index]);
  const sets = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const printing of app.index.bundle.printings) {
      const code = printing.setCode.toLowerCase();
      const name = printing.setName?.trim() || code.toUpperCase();
      if (!byCode.has(code) || byCode.get(code) === code.toUpperCase()) byCode.set(code, name);
    }
    return [...byCode].map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  }, [app.index]);
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
    setSheet(prev => prev?.kind === 'match' ? prev : null);
    setPendingRead(false);
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
  const unpricedCount = staged.reduce((sum, row) => sum + (cardPrice(pricedCards[row.printing.id], row.draft.finish) == null ? row.draft.quantity : 0), 0);
  const totalValueLabel = scannedCount > 0 && unpricedCount === scannedCount ? '—' : `${money(knownValue)}${unpricedCount ? '+' : ''}`;
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
    && !app.catalogLoading && !app.disabled && !sessionReviewOpen && !setPickerOpen && !detailOpen && !app.review;

  function captureCard() {
    if (!scannerActive || settingsOpen || mode !== 'single') return;
    setSheet(prev => prev?.kind === 'match' ? prev : { kind: 'reading' });
    setPendingRead(true);
    setReadingEpoch(e => e + 1);
    void scanner.current?.captureNow();
  }

  // The native lock needs confidence >= 0.70 but the outline draws at less, so
  // a steady low-confidence card would sit on "Reading" forever. After a few
  // seconds, show a hint that the user can try a tap in single mode.
  useEffect(() => {
    setReadingStale(false);
    if ((!pendingRead && sheet?.kind !== 'reading') || !outlineFound) return;
    const timer = setTimeout(() => setReadingStale(true), 3000);
    return () => clearTimeout(timer);
  }, [pendingRead, sheet?.kind, outlineFound, readingEpoch]);

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
    if (!scannerActive) return;
    const { title, lines, printingLines, source } = event.nativeEvent;
    // A continuous read already in flight can finish just after switching modes.
    if (mode === 'single' && source !== 'guide') return;
    setPendingRead(false);
    const result = pipeline.matchEvidence({ lines, printingLines });
    const scoped = lockedSetCode ? candidatesInLockedSet(result.candidates, app.index, lockedSetCode) : result.candidates;
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
      setSheet(prev => prev?.kind === 'match' ? prev : { kind: 'unreadable' });
      return;
    }
    const allPrintings = app.index.printingsOf(scoped[0]!.printing.oracleId)
      .filter(p => !lockedSetCode || p.setCode.toLowerCase() === lockedSetCode);
    const ranking = rankPrintings(allPrintings, printingHints(printingLines, app.index.setCodes));
    const resolvedPrinting = bestGuessPrinting(ranking);
    const printing = resolvedPrinting ?? (lockedSetCode ? ranking.ranked[0]?.printing : null) ?? scoped[0]!.printing;
    mort.react(band === 'confident' ? 'scan_success' : 'scan_uncertain');
    // Both modes stage the read immediately. An uncertain printing stays
    // editable in the result sheet and session review.
    const needsPrintingChoice = printingNeedsChoice(ranking);
    recordRead(printing, needsPrintingChoice);
    const stagedId = stageFromCapture(printing, band, result.languageHint);
    setSheet({ kind: 'match', printing, band, stagedId, needsPrintingChoice });
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
      setSheet(prev => prev?.kind === 'match' ? prev : { kind: 'reading' });
      setPendingRead(true);
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
    setPendingRead(false);
    setSheet(prev => (prev?.kind === 'reading' ? null : prev));
  }

  function onOutlineChange(event: { nativeEvent: { found: boolean } }) {
    const found = event.nativeEvent.found;
    outlineFoundRef.current = found;
    setOutlineFound(found);
    if (mode === 'single') return;
    if (found) {
      // Keep the last result visible until another successful read replaces it.
      if (cardGone.current) {
        setSheet(prev => prev?.kind === 'match' ? prev : { kind: 'reading' });
        setPendingRead(true);
        setReadingEpoch(e => e + 1);
      }
      cardGone.current = false;
    } else {
      // The outline vanished before locking (moved away, too unsteady): don't
      // leave "reading" up forever waiting for a read that isn't coming.
      setSheet(prev => (prev?.kind === 'reading' ? null : prev));
      setPendingRead(false);
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

  /** A printing chosen in the card details sheet updates the staged scan. */
  function chooseDetailPrinting(printing: Printing) {
    if (!detailOpen) return;
    const row = stagedRef.current.find(item => item.id === detailOpen.rowId);
    if (!row || printing.oracleId !== row.printing.oracleId ||
        (lockedSetCode && row.printing.setCode.toLowerCase() === lockedSetCode && printing.setCode.toLowerCase() !== lockedSetCode)) return;
    if (row.attempted) { app.setMessage('This scan already had a failed save attempt. Retry it as-is, or remove it and scan again.'); return; }
    patchStagedRow(row.id, current => {
      const finish: Finish = printing.finishes.includes(current.draft.finish) ? current.draft.finish : printing.finishes[0]!;
      return { ...current, printing, draft: validateDraft({ ...current.draft, card_id: printing.id, finish }, printing) };
    });
    setSheet(prev => prev?.kind === 'match' && prev.stagedId === row.id
      ? { ...prev, printing, needsPrintingChoice: false }
      : prev);
  }

  function editStaged(id: string, patch: Partial<CollectionDraft>) {
    patchStagedRow(id, row => ({ ...row, draft: validateDraft({ ...row.draft, ...patch }, row.printing) }));
  }

  /** Session-review's "Change printing…" — the same swap `choosePrinting`
   * does for the live sheet's staged row, but driven by the picker in
   * ScanSessionSummary rather than the camera's card details sheet, and with
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

  const navClearance = Math.max(insets.bottom + 62, 86);
  const renderSessionSummary = () => (
    <ScanSessionSummary
      visible={sessionReviewOpen}
      bottom={navClearance}
      staged={staged}
      locations={app.locations}
      index={app.index}
      committing={committing}
      priceForRow={item => cardPrice(pricedCards[item.printing.id], item.draft.finish)}
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

  // Live scanning is an iPhone feature for now (owner decision). Everywhere
  // else the session list and its manual "+" add are still fully usable, so
  // this offers them rather than a dead end -- and deliberately does NOT fall
  // back to the old take-a-photo-on-a-timer loop, which never worked.
  if (!scannerViewAvailable) {
    return (
      <View style={styles.full}>
        <View style={styles.panel}>
          <MortStage size="M" />
          <Text style={styles.panelTitle}>Live scanning needs the iPhone app for now</Text>
          <Text style={styles.panelBody}>You can still build this session by name, then add it to your collection.</Text>
          <Button label={`Add cards by name (${staged.length})`} onPress={() => setSessionReviewOpen(true)} />
        </View>
        {renderSessionSummary()}
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
  const displayRow = sheet?.kind === 'match' ? stagedRow : lastScannedRow;
  const displayPrintingId = sheet?.kind === 'match' ? sheet.printing.id : displayRow?.printing.id;
  // Keep the dock below the native guide's bottom edge (73.3% of the camera
  // viewport), including on compact iPhones, without moving its capture crop.
  const dockHeight = Math.min(80, Math.max(68, windowHeight * 0.267 - navClearance - 12));

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

      {mode === 'single' && <Pressable accessibilityRole="button" accessibilityLabel="Tap camera to capture card" disabled={!scannerActive || settingsOpen} onPress={captureCard} style={StyleSheet.absoluteFill} />}

      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <TopControl label={torchEnabled ? 'Turn flashlight off' : 'Turn flashlight on'} name={torchEnabled ? 'flash' : 'flash-outline'} selected={torchEnabled} onPress={() => setTorchEnabled(v => !v)} />
        <TopControl label={lockedSetCode ? `Choose set lock, currently ${sets.find(item => item.code === lockedSetCode)?.name ?? lockedSetCode.toUpperCase()}` : 'Choose a set lock'} name="lock-open-outline" icon={lockedSetCode ? <SetIcon key={lockedSetCode} code={lockedSetCode} /> : undefined} selected={!!lockedSetCode} onPress={() => { setSettingsOpen(false); setSetPickerOpen(true); }} />
        <TopControl label="Scan settings" name="settings-outline" selected={settingsOpen} onPress={() => setSettingsOpen(v => !v)} />
        <TopControl label={`Review scanned cards, ${scannedCount} copies`} name="albums-outline" badge={scannedCount} onPress={() => setSessionReviewOpen(true)} />
      </View>
      <View pointerEvents="none" style={[styles.totalPill, { top: insets.top + 66 }]}>
        <Text accessibilityLabel={unpricedCount ? `${money(knownValue)} in known card prices; ${unpricedCount} ${unpricedCount === 1 ? 'copy' : 'copies'} without a price` : `Total scanned card prices ${money(knownValue)}`} style={styles.totalPillText}>{totalValueLabel}</Text>
      </View>

      {/* The app shell's banner is hidden while the live view is up (see
          App.tsx), so a message has to surface here or nowhere. */}
      {!!app.message && (
        <Pressable style={[styles.banner, { top: insets.top + 102 }]} onPress={() => app.setMessage('')}>
          <DismissingNotice style={styles.bannerText} onDone={() => app.setMessage('')}>{app.message}</DismissingNotice>
        </Pressable>
      )}

      {settingsOpen && (
        // Capped above the result sheet and scrollable: the language chips wrap to
        // as many rows as the width needs, and on a short phone (or landscape) an
        // uncapped panel ran down behind the sheet with nothing to scroll it into reach.
        <View style={[styles.settings, { top: insets.top + 102, maxHeight: Math.max(160, windowHeight - (insets.top + 102) - (SHEET_RESERVE + insets.bottom)) }]}>
          <View style={styles.settingsHeader}>
            <Text style={styles.settingsTitle}>Scan settings</Text>
            <IconButton label="Close scan settings" name="close" onPress={() => setSettingsOpen(false)} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.settingsContent}>
              <Text style={styles.settingsLabel}>Scan mode</Text>
              <View style={styles.modeRow}>
                <ModeGlyph label="Single card mode" title="Single" icon="filter-1" selected={mode === 'single'} onPress={() => selectMode('single')} />
                <ModeGlyph label="Continuous scanning mode" title="Continuous" icon="playlist-add" selected={mode === 'continuous'} onPress={() => selectMode('continuous')} />
              </View>
              <ScanQuickBar
                language={quickLanguage}
                onSelectLanguage={setQuickLanguage}
                quantity={quickQuantity}
                onChangeQuantity={setQuickQuantity}
              />
            </View>
          </ScrollView>
        </View>
      )}

      <SetLockPicker visible={setPickerOpen} sets={sets} selected={lockedSetCode} onChoose={code => { setLockedSetCode(code); setSetPickerOpen(false); }} onClose={() => setSetPickerOpen(false)} />
      <CardDetails
        name={detailOpen?.name ?? null}
        printingId={detailOpen?.printingId}
        printingCheck={detailOpen?.printingCheck}
        ownedFinish={detailOpen ? staged.find(row => row.id === detailOpen.rowId)?.draft.finish : null}
        stagedScan
        allowedSetCode={detailOpen && staged.find(row => row.id === detailOpen.rowId)?.printing.setCode.toLowerCase() === lockedSetCode ? lockedSetCode : null}
        onChoosePrinting={chooseDetailPrinting}
        onClose={() => setDetailOpen(null)}
      />

      <View pointerEvents="box-none" style={[styles.bottomArea, { bottom: navClearance }]}>
        {mode === 'single' && <Text pointerEvents="none" style={styles.tapHint}>Tap screen to scan</Text>}
        {(sheet || displayRow) && <View style={[styles.resultDock, { height: dockHeight }]}>
          <ResultTile
            sheet={sheet}
            stale={readingStale}
            singleMode={mode === 'single'}
            row={displayRow}
            price={cardPrice(pricedCards[displayPrintingId ?? ''], displayRow?.draft.finish ?? 'nonfoil')}
            onOpenDetails={() => { if (displayRow) setDetailOpen({ rowId: displayRow.id, name: displayRow.printing.name, printingId: displayRow.printing.id, printingCheck: sheet?.kind === 'match' && sheet.stagedId === displayRow.id && sheet.needsPrintingChoice ? { required: true } : undefined }); }}
            height={dockHeight}
          />
          <View style={styles.resultActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={lastScannedRow?.draft.finish === 'foil' ? `Remove foil from ${lastScannedRow.printing.name}` : `Make ${lastScannedRow?.printing.name ?? 'last card'} foil`} accessibilityState={{ disabled: !canToggleLastFoil, selected: lastScannedRow?.draft.finish === 'foil' }} disabled={!canToggleLastFoil} hitSlop={{ top: 2, bottom: 2 }} style={[styles.bottomAction, lastScannedRow?.draft.finish === 'foil' && styles.bottomActionOn, !canToggleLastFoil && styles.disabledAction]} onPress={() => { if (lastScannedRow) toggleFoil(lastScannedRow.id); }}>
              <Image source={require('../assets/foil-f.png')} style={styles.foilGlyph} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Add another copy of ${lastScannedRow?.printing.name ?? 'last card'}`} accessibilityState={{ disabled: !lastScannedRow }} disabled={!lastScannedRow} hitSlop={{ top: 2, bottom: 2 }} style={[styles.bottomAction, !lastScannedRow && styles.disabledAction]} onPress={() => { if (lastScannedRow) addAnotherCopy(lastScannedRow.id); }}>
              <Text style={styles.bottomActionText}>+1</Text>
            </Pressable>
          </View>
        </View>}
      </View>
      {renderSessionSummary()}
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

function IconButton({ label, name, selected, onPress }: { label: string; name: keyof typeof Ionicons.glyphMap; selected?: boolean; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }} style={[styles.iconButton, selected && styles.iconButtonSelected]} onPress={onPress}>
      <Ionicons name={name} size={22} color={selected ? brand.ink : brand.parchment} />
    </Pressable>
  );
}

function TopControl({ label, name, icon, badge, selected, disabled, onPress }: {
  label: string;
  name: keyof typeof Ionicons.glyphMap;
  icon?: React.ReactNode;
  badge?: number;
  selected?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  const styles = useStyles();
  const color = selected ? brand.ink : brand.parchment;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[styles.topControl, selected && styles.topControlSelected, disabled && styles.disabledAction]}>
      {icon ?? <Ionicons name={name} size={24} color={color} />}
      {badge !== undefined && <View pointerEvents="none" style={styles.countBadge}><Text style={styles.countBadgeText}>{badge > 99 ? '99+' : badge}</Text></View>}
    </Pressable>
  );
}

function SetIcon({ code }: { code: string }) {
  const styles = useStyles();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.setIcon}>
      {!loaded && <Text style={styles.setIconFallback}>{code.toUpperCase().slice(0, 4)}</Text>}
      {!failed && <SvgUri width={26} height={26} uri={`https://svgs.scryfall.io/sets/${code}.svg`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </View>
  );
}

function ModeGlyph({ label, title, icon, selected, onPress }: {
  label: string; title: string; icon: keyof typeof MaterialIcons.glyphMap; selected: boolean; onPress(): void;
}) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} style={[styles.modeChoice, selected && styles.modeChoiceSelected]} onPress={onPress}>
      <MaterialIcons name={icon} size={19} color={selected ? brand.ink : brand.parchment} />
      <Text style={[styles.modeChoiceText, selected && styles.modeChoiceTextSelected]}>{title}</Text>
    </Pressable>
  );
}

/**
 * The result tile: thumbnail, status, card name, printing and price.
 * It stays on screen after the card leaves the frame,
 * so the printing picker and the foil toggle remain reachable for the card
 * just scanned rather than vanishing with it.
 */
function ResultTile({ sheet, stale, singleMode, row, price, height, onOpenDetails }: {
  sheet: SheetState | null; stale: boolean; singleMode: boolean; row: StagedCard | null; price: number | null; height: number;
  onOpenDetails(): void;
}) {
  const styles = useStyles();
  if (sheet?.kind === 'reading' && !row) {
    return (
      <View style={[styles.resultCard, { height }]}>
        <View style={styles.thumbPlaceholder} />
        <View style={styles.sheetBody}>
          <Text style={styles.sheetStatus}>READING CARD</Text>
          <Text style={styles.sheetName}>{stale && singleMode ? 'Tap the screen to try again' : 'Hold it steady…'}</Text>
        </View>
      </View>
    );
  }
  if (sheet?.kind === 'unreadable' && !row) {
    return (
      <View style={[styles.resultCard, { height }]}>
        <View style={styles.thumbPlaceholder} />
        <View style={styles.sheetBody}>
          <Text style={styles.sheetNote}>{singleMode ? 'Couldn\u2019t read that one. Tap the screen to try again.' : 'Couldn\u2019t read that one. Try again.'}</Text>
        </View>
      </View>
    );
  }

  const printing = sheet?.kind === 'match' ? sheet.printing : row?.printing;
  if (!printing) return null;
  const band = sheet?.kind === 'match' ? sheet.band : row?.band;
  const needsReview = (sheet?.kind === 'match' && sheet.needsPrintingChoice) || band !== 'confident';
  const rarityColor = printing.rarity === 'mythic' ? '#E67342' : printing.rarity === 'rare' ? '#D7B65B' : printing.rarity === 'uncommon' ? '#B8BEC6' : '#D9D1C2';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${printing.name}. Open card details and change printing.`} accessibilityHint={needsReview ? 'Check that this is the correct printing.' : undefined} disabled={!row} style={[styles.resultCard, { height }]} onPress={onOpenDetails}>
        {printing.imageUri
          ? <Image source={{ uri: printing.imageUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
          : <View style={styles.thumbPlaceholder} />}
        <View style={styles.sheetBody}>
          <Text style={styles.sheetName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{printing.name}</Text>
          <View style={styles.setLine}>
            <Ionicons name="diamond-outline" size={15} color={rarityColor} accessibilityLabel="Set symbol" />
            <Text style={styles.setBadge} numberOfLines={1}>{printing.setCode.toUpperCase()}</Text>
            <Text style={[styles.sheetCaption, styles.metadataNumber]} numberOfLines={1}>#{printing.collectorNumber}</Text>
            <View style={styles.metadataSpacer} />
            <Text style={styles.price} accessibilityLabel={price == null ? 'Price unavailable' : undefined} numberOfLines={1}>{price == null ? '—' : money(price)}</Text>
            {row && <Text style={styles.sheetCaption}>({row.draft.quantity})</Text>}
          </View>
        </View>
        {row && <Ionicons name="chevron-forward" size={12} color={needsReview ? accent.DEFAULT : brand.parchment} />}
    </Pressable>
  );
}

type SetOption = { code: string; name: string };

function SetLockPicker({ visible, sets, selected, onChoose, onClose }: {
  visible: boolean; sets: SetOption[]; selected: string | null; onChoose(code: string | null): void; onClose(): void;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => { if (visible) setQuery(''); }, [visible]);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle ? sets.filter(set => set.name.toLocaleLowerCase().includes(needle) || set.code.includes(needle)) : sets;
  return (
    <Modal transparent visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.lockOverlay}>
        <Pressable accessibilityLabel="Close set picker" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.lockSheet, { height: Math.min(height * 0.72, 620, height - keyboardHeight - insets.top - space.md), paddingBottom: keyboardHeight ? space.sm : insets.bottom + space.sm }]}>
          <View style={styles.lockHeader}>
            <View style={styles.grow}>
              <Text style={styles.lockTitle}>Lock to a set</Text>
              <Text style={styles.lockSubtitle}>Scans will use printings from this set.</Text>
            </View>
            <IconButton label="Close set picker" name="close" onPress={onClose} />
          </View>
          <TextInput accessibilityLabel="Search sets" autoCapitalize="none" autoCorrect={false} placeholder="Search sets or codes" placeholderTextColor={brand.bone} value={query} onChangeText={setQuery} style={styles.lockSearch} />
          <Pressable accessibilityRole="button" accessibilityLabel="No set lock" accessibilityState={{ selected: selected === null }} style={[styles.lockRow, selected === null && styles.lockRowSelected]} onPress={() => onChoose(null)}>
            <Text style={styles.lockName}>No set lock</Text>
            {selected === null && <Ionicons name="checkmark" size={19} color={accent.DEFAULT} />}
          </Pressable>
          <FlatList
            data={filtered}
            keyExtractor={item => item.code}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={16}
            maxToRenderPerBatch={24}
            ListEmptyComponent={<Text style={styles.lockEmpty}>No sets match “{query}”.</Text>}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.code.toUpperCase()}`} accessibilityState={{ selected: selected === item.code }} style={[styles.lockRow, selected === item.code && styles.lockRowSelected]} onPress={() => onChoose(item.code)}>
                <Text style={styles.lockName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.lockCode}>{item.code.toUpperCase()}</Text>
                {selected === item.code && <Ionicons name="checkmark" size={19} color={accent.DEFAULT} />}
              </Pressable>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
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

const SHEET_DARK = 'rgba(31,31,31,0.90)';
// Scan settings stay clear of the card dock.
const SHEET_RESERVE = 210;
const TOP_BAR_DARK = 'rgba(31,31,31,0.42)';

const useStyles = makeStyles(() => StyleSheet.create({
  full: { flex: 1, backgroundColor: brand.ink },
  grow: { flex: 1 },
  panel: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md, backgroundColor: surface.canvas },
  panelTitle: { color: text.primary, fontSize: 21, textAlign: 'center', fontWeight: '600' },
  panelBody: { color: text.secondary, fontSize: 13, textAlign: 'center' },

  topBar: { position: 'absolute', left: space.md, right: space.md, height: 52, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: TOP_BAR_DARK, borderRadius: radius.md, paddingHorizontal: space.xs },
  totalPill: { position: 'absolute', alignSelf: 'center', minHeight: 28, justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: TOP_BAR_DARK, borderRadius: radius.pill },
  totalPillText: { color: brand.parchment, fontSize: 11, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  iconButtonSelected: { backgroundColor: accent.DEFAULT },
  topControl: { flex: 1, minWidth: 0, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  topControlSelected: { backgroundColor: accent.DEFAULT },
  setIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  setIconFallback: { position: 'absolute', color: brand.ink, fontSize: 11, fontWeight: '800' },
  countBadge: { position: 'absolute', top: 0, right: 6, minWidth: 19, height: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderRadius: radius.pill, backgroundColor: accent.DEFAULT },
  countBadgeText: { color: brand.ink, fontSize: 10, fontWeight: '800' },

  banner: { position: 'absolute', left: space.md, right: space.md },
  bannerText: { backgroundColor: surface.raised, borderRadius: radius.md, padding: space.sm, overflow: 'hidden' },
  settings: { position: 'absolute', left: space.md, right: space.md },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: SHEET_DARK, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, paddingLeft: space.md },
  settingsTitle: { color: brand.parchment, fontSize: 15, fontWeight: '700' },
  settingsContent: { gap: space.sm, backgroundColor: SHEET_DARK, padding: space.sm, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  settingsLabel: { color: brand.bone, fontSize: 11, fontWeight: '700' },
  modeRow: { flexDirection: 'row', gap: space.sm },
  modeChoice: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: 'rgba(245,237,224,0.24)' },
  modeChoiceSelected: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  modeChoiceText: { color: brand.parchment, fontSize: 12, fontWeight: '700' },
  modeChoiceTextSelected: { color: brand.ink },

  bottomArea: { position: 'absolute', left: space.md, right: space.md, alignItems: 'stretch' },
  tapHint: { alignSelf: 'center', color: 'rgba(245,237,224,0.68)', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: space.sm },
  resultDock: { width: '100%', flexDirection: 'row', gap: space.sm },
  resultActions: { flex: 1, gap: space.xs },
  bottomAction: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.md, backgroundColor: SHEET_DARK },
  bottomActionOn: { backgroundColor: accent.DEFAULT },
  disabledAction: { opacity: 0.35 },
  bottomActionText: { color: brand.parchment, fontSize: 18, fontWeight: '800' },
  foilGlyph: { width: 34, height: 34 },

  resultCard: { flex: 4, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: SHEET_DARK, borderRadius: radius.lg, padding: 5, borderWidth: 1, borderColor: 'rgba(245,237,224,0.14)' },
  thumb: { width: 38, height: 54, borderRadius: radius.thumb },
  thumbPlaceholder: { width: 38, height: 54, borderRadius: radius.thumb, backgroundColor: 'rgba(245,237,224,0.12)' },
  sheetBody: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 3 },
  sheetStatus: { color: accent.DEFAULT, fontSize: 9, letterSpacing: 0.8, fontWeight: '800' },
  sheetName: { color: brand.parchment, fontSize: 14, fontWeight: '800' },
  sheetCaption: { color: brand.bone, fontSize: 11 },
  setLine: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  setBadge: { color: brand.parchment, fontSize: 11, fontWeight: '800' },
  metadataNumber: { flexShrink: 1, minWidth: 0 },
  metadataSpacer: { flex: 1, minWidth: 0 },
  price: { color: brand.parchment, fontSize: 11, fontWeight: '700' },
  sheetNote: { color: brand.bone, fontSize: 13 },

  lockOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.54)' },
  lockSheet: { backgroundColor: brand.ink, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.md, paddingTop: space.sm },
  lockHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.sm },
  lockTitle: { color: brand.parchment, fontSize: 18, fontWeight: '800' },
  lockSubtitle: { color: brand.bone, fontSize: 12, marginTop: 2 },
  lockSearch: { height: 44, color: brand.parchment, backgroundColor: 'rgba(245,237,224,0.12)', borderRadius: radius.md, paddingHorizontal: space.md, marginBottom: space.sm, fontSize: 14 },
  lockRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(245,237,224,0.22)', paddingHorizontal: space.sm },
  lockRowSelected: { backgroundColor: 'rgba(201,163,74,0.14)' },
  lockName: { flex: 1, color: brand.parchment, fontSize: 14, fontWeight: '600' },
  lockCode: { color: brand.bone, fontSize: 11, fontWeight: '700' },
  lockEmpty: { color: brand.bone, textAlign: 'center', padding: space.lg },
}));
