import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Image, Keyboard, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CONDITIONS, ConfirmScan, FINISHES, LANGUAGES, artSwitchNow, finishSummary, thumbnailUri, type ArtResult, type Condition, type Finish, type StackMoveDraft } from '@upkeep/scan-core';
import { isSameCard, reconcileFinish } from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { reprintWriter, writer } from '../backend';
import {
  FORMATS, LOAD_FAILED, addToWishList, cachedPrinting, cachedPrintings, fetchFriendActivity, fetchOwned, fetchPrinting, fetchPrintings, fetchScryfallExtras, fetchWantedQuantity,
  pickRepresentative, seedToPrinting, toPrinting,
  type CardPrinting, type CardSeed, type FriendActivity, type Legality, type OwnedStack, type ScryfallExtras,
} from '../cardDetails';
import type { CardDetailsTarget } from '../cardDetailsHost';
import { errorMessage } from '../errors';
import { compareScanToPrintings } from '../printingVerify';
import { makeStyles } from '../preferences';
import { accent, border, duration, radius, scrim, space, state as stateColor, surface, text, type } from '../theme';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Button, Choices, Notice } from './ui';
import { FoilArt } from './FoilArt';
import { ManaCost } from './ManaCost';
import { useRegisterOverlay } from '../overlays';

const CARD_ASPECT = 488 / 680;
/** Width of one printing tile in the printings strip; fixed so the windowed list can place tiles without measuring. */
const PRINTING_TILE_W = 84;

const money = (v: number | null) => (v === null ? null : `$${v.toFixed(2)}`);

/** Title-case labels for the reprint panel's finish picker — matches src/lib/types.ts's FINISH_LABELS on the web. */
const FINISH_LABELS: Record<Finish, string> = { nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched', glossy: 'Glossy' };

/** Mirrors src/lib/collection/pricing.ts's priceFor: exact finish match only, no fallback — the reprint panel says the
 *  price out loud, so it must not overstate it the way displayPrice's `~` fallback would. */
function priceForFinish(p: CardPrinting | null, finish: Finish): number | null {
  if (!p) return null;
  if (finish === 'foil') return p.priceUsdFoil;
  if (finish === 'etched') return p.priceUsdEtched;
  return p.priceUsd;
}

type PriceVariant = { finish: Finish; label: string; value: number };

/** The variants that have a price, in display order. A price that exists for a finish the printing lacks still shows: Scryfall's data wins over our assumption. */
function priceVariants(p: CardPrinting): PriceVariant[] {
  const all: Array<[Finish, string, number | null]> = [['nonfoil', 'Nonfoil', p.priceUsd], ['foil', 'Foil', p.priceUsdFoil], ['etched', 'Etched', p.priceUsdEtched]];
  return all.flatMap(([finish, label, value]) => (value === null ? [] : [{ finish, label, value }]));
}

/** The finish this copy is known to be, if it is: the one you own or are adding, or the only one the printing exists in. */
function knownFinishOf(p: CardPrinting, ownedFinish: string | null | undefined, adding: boolean, formFinish: Finish): Finish | null {
  if (adding) return formFinish;
  if (ownedFinish && (FINISHES as readonly string[]).includes(ownedFinish)) return ownedFinish as Finish;
  return p.finishes.length === 1 ? p.finishes[0]! : null;
}

/**
 * Details for one card, opened by tapping it in search results: the art, the
 * rules text, every printing, what you already own of it, and buttons to add
 * it to the collection (choosing finish, condition, language, destination and
 * quantity) or the wish list.
 *
 * Adding goes through the same ConfirmScan -> apply_stack_addition path the
 * scanner uses, with one operation id per open form so a retry after a network
 * blip cannot add twice.
 */
const LEGALITY_LABELS: Record<Legality, string> = { legal: 'Legal', not_legal: 'Not legal', banned: 'Banned', restricted: 'Restricted' };

// How far or how fast a pull must go to count as "close", not "wobble".
const CLOSE_DRAG_DISTANCE = 100;
const CLOSE_DRAG_VELOCITY = 0.8;
const OVERSCROLL_CLOSE = 70;

export function CardDetails({ name, printingId, seed, scan, ownedFinish, onChanged, onClose }: {
  name: string | null;
  /** Open on this printing (e.g. the one you own) instead of the default. */
  printingId?: string | null;
  /** What the caller already knows about that printing; painted at once, with no network. */
  seed?: CardSeed | null;
  /** Called after this sheet changed the collection or wish list, so the caller can refresh. */
  onChanged?(): void;
  /** Quick scan's photo and candidate printings: checked in the background, and may switch the selection (see cardDetailsHost). */
  scan?: CardDetailsTarget['scan'];
  /** The finish of the copy this sheet was opened from, so a foil copy shows foil. */
  ownedFinish?: string | null;
  onClose(): void;
}) {
  useRegisterOverlay(name !== null);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  // Sheet position: 0 is open, windowHeight is off-screen. One value drives the slide-in,
  // the finger drag, the slide-out and the scrim fade, so they can never disagree.
  //
  // Why this is not a native pageSheet any more: iOS lets a pageSheet be pulled down only
  // by a swipe that starts on its non-scrolling part, and the body here is one big
  // ScrollView, so in practice only the ~50pt top bar worked and a pull from the card art
  // scrolled instead. Owning the gesture lets the whole top bar (and an overscroll pull on
  // the body) close it. No Reanimated or Gesture Handler in the app, so this is the core
  // Animated + PanResponder pair, all on the native driver.
  const y = useRef(new Animated.Value(windowHeight)).current;
  const closing = useRef(false);
  // True while the slide-in runs: a drag then would fight the native-driven timing for `y`.
  const entering = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const motionRef = useRef({ reducedMotion, windowHeight });
  motionRef.current = { reducedMotion, windowHeight };

  // The Modal is transparent and status-bar translucent, so neither platform resizes it for
  // the keyboard. iOS: the ScrollView insets itself (automaticallyAdjustKeyboardInsets) and
  // scrolls the focused field into view. Android: lift the sheet's bottom edge by the keyboard
  // height so the ScrollView shrinks and Android scrolls the focused field into view.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', e => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const isOpen = !!name;
  useEffect(() => {
    if (!isOpen) return;
    closing.current = false;
    entering.current = true;
    y.setValue(motionRef.current.windowHeight);
    Animated.timing(y, { toValue: 0, duration: motionRef.current.reducedMotion ? 0 : duration.quick, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { entering.current = false; });
  }, [isOpen, y]);

  // Slides out from wherever the sheet is (mid-drag included), then asks the parent to close.
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    entering.current = false;
    const { reducedMotion: reduced, windowHeight: h } = motionRef.current;
    Animated.timing(y, { toValue: h, duration: reduced ? 0 : duration.micro, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => onCloseRef.current());
  }, [y]);
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const dragZone = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !entering.current && !closing.current && g.dy > 4 && g.dy > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => { if (!closing.current) y.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_e, g) => {
      if (closing.current) return;
      if (g.dy > CLOSE_DRAG_DISTANCE || g.vy > CLOSE_DRAG_VELOCITY) { requestCloseRef.current(); return; }
      Animated.timing(y, { toValue: 0, duration: motionRef.current.reducedMotion ? 0 : duration.micro, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => {
      // A close already under way must run to the end, not be pulled back open.
      if (closing.current) return;
      Animated.timing(y, { toValue: 0, duration: motionRef.current.reducedMotion ? 0 : duration.micro, useNativeDriver: true }).start();
    },
  })).current;

  // Pulling the body down past its top and letting go closes it too. iOS only: it relies on
  // the rubber-band overscroll (negative contentOffset), which Android's ScrollView does not
  // have; there the top-bar drag, the X and the back button are the ways to close.
  const onScrollEndDrag = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (e.nativeEvent.contentOffset.y < -OVERSCROLL_CLOSE) requestCloseRef.current();
  }, []);
  const app = useApp();
  const [printings, setPrintings] = useState<CardPrinting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [owned, setOwned] = useState<OwnedStack[]>([]);
  // 'error' is unknown, not empty: a failed fetch must never read as "you don't own this card".
  const [ownedState, setOwnedState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [wanted, setWanted] = useState(0);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [faceIndex, setFaceIndex] = useState(0);
  const [friends, setFriends] = useState<FriendActivity | null>(null);
  // The full printing list can trail the first paint (the sheet opens on a seed or a cached row first).
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  // The selected printing's own row (rules text, faces) can trail it too; a failure offers a retry instead of hanging.
  const [detailFailed, setDetailFailed] = useState(false);
  // Bumped by "Try again" to re-run the matching fetch effect.
  const [listTick, setListTick] = useState(0);
  const [detailTick, setDetailTick] = useState(0);
  // Tagged with the card and scan it was computed for, so a result can never be applied to another card.
  const [art, setArt] = useState<{ name: string; scan: NonNullable<CardDetailsTarget['scan']>; result: ArtResult } | null>(null);
  const [artNote, setArtNote] = useState<string | null>(null);
  const [extras, setExtras] = useState<{ state: 'idle' | 'loading' | 'error' | 'ready'; data?: ScryfallExtras }>({ state: 'idle' });

  const [adding, setAdding] = useState(false);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [condition, setCondition] = useState<Condition>('NM');
  const [language, setLanguage] = useState('en');
  const [location, setLocation] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const operationId = useRef<string | null>(null);
  const confirm = useRef<ConfirmScan | null>(null);
  // The background picture match may only switch a selection nobody has touched.
  const userPicked = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const printingIdRef = useRef<string | null | undefined>(printingId);
  printingIdRef.current = printingId;
  const printingsRef = useRef<CardPrinting[]>([]);
  // The seed is read once per open, from a ref, so a caller re-creating the object cannot re-run the open effect.
  const seedRef = useRef<CardSeed | null | undefined>(seed);
  seedRef.current = seed;
  // Held in a ref so a session refresh (new userId identity) does not re-run the reset effect and wipe an open add form.
  const userIdRef = useRef(app.userId);
  userIdRef.current = app.userId;
  // Only the newest user-data round may write state: the early one-printing round can finish after the full one.
  const userSeq = useRef(0);

  printingsRef.current = printings;
  const selected = printings.find(p => p.id === selectedId) ?? null;
  const refreshUserData = useCallback(async (cardName: string, ids: string[], selected: string | null) => {
    const userId = userIdRef.current;
    if (!userId) return;
    const seq = ++userSeq.current;
    const [o, w, f] = await Promise.all([
      fetchOwned(userId, cardName),
      fetchWantedQuantity(userId, ids).catch(() => 0),
      fetchFriendActivity(userId, ids, selected).catch(() => null),
    ]);
    if (seq !== userSeq.current) return;
    setOwned(o.stacks);
    setOwnedState(o.error ? 'error' : 'ready');
    setWanted(w);
    setFriends(f);
  }, []);

  const select = useCallback((id: string | null) => { selectedRef.current = id; setSelectedId(id); }, []);

  // Open: paint at once from what is already in hand (a cached row or list, else the
  // caller's seed), then let the fetch effects below fill in. Nothing here waits on the network.
  // Deps are the identity of the card being shown only; `scan` is a whole-open constant.
  useEffect(() => {
    if (!name) {
      // Closing must not leave the last card's results behind for the next open.
      userSeq.current++;
      userPicked.current = false;
      setPrintings([]); setOwnedState('loading'); setListState('loading'); setArt(null); setArtNote(null); setDetailFailed(false);
      // The flipped side is never kept: the next card opens on its front.
      setFaceIndex(0);
      return;
    }
    userPicked.current = false;
    const cachedList = cachedPrintings(name);
    const cachedRow = printingId ? cachedPrinting(printingId) : undefined;
    const seedP = seedRef.current && seedRef.current.id === printingId ? seedToPrinting(seedRef.current) : null;
    let initial: CardPrinting[] = cachedList ?? [];
    if (cachedRow) initial = initial.map(p => (p.id === cachedRow.id ? cachedRow : p));
    // The opened-on printing, when the list in hand lacks it (or there is no list): a full cached row
    // beats the seed. Without this a cached list would open on some other printing.
    const known = cachedRow ?? seedP;
    if (known && !initial.some(p => p.id === known.id)) initial = [known, ...initial];
    const start = initial.find(p => p.id === printingId) ?? (cachedList ? pickRepresentative(initial) : null) ?? initial[0] ?? null;
    // Nothing in hand for the requested printing: select it anyway. The by-id effect below then
    // fetches that single row, so the sheet paints without waiting for the whole printing list.
    select(start?.id ?? printingId ?? null);
    setPrintings(initial); setLoading(initial.length === 0); setLoadError(null); setListState(cachedList ? 'ready' : 'loading'); setDetailFailed(false);
    setOwned([]); setOwnedState(userIdRef.current ? 'loading' : 'ready'); setWanted(0); setStatus(null); setAdding(false); setFaceIndex(0); setFriends(null); setArt(null); setArtNote(null); setExtras({ state: 'idle' });
    // Owned copies need only the name, so they start now, in parallel with the printing fetches.
    void refreshUserData(name, initial.map(p => p.id), start?.id ?? printingId ?? null);
  }, [name, printingId, refreshUserData, select]);

  // The full printing list. Skipped when a recent open already cached it.
  useEffect(() => {
    if (!name || cachedPrintings(name)) return;
    let alive = true;
    setListState('loading');
    void fetchPrintings(name).then(({ printings: list, error }) => {
      if (!alive) return;
      setLoading(false);
      if (error || list.length === 0) {
        if (printingsRef.current.length > 0) setListState('error'); else setLoadError(error ?? 'No printings found for this card.');
        return;
      }
      // Keep any full row already fetched for a printing (the light list rows have no rules text).
      setPrintings(prev => list.map(p => prev.find(x => x.id === p.id && x.full) ?? p));
      setListState('ready');
      // Keep whatever is selected (the opened-on row, or one the person chose meanwhile).
      const start = list.find(p => p.id === printingIdRef.current) ?? pickRepresentative(list) ?? list[0]!;
      const keep = selectedRef.current && list.some(p => p.id === selectedRef.current) ? selectedRef.current : start.id;
      select(keep);
      void refreshUserData(name, list.map(p => p.id), keep);
    });
    return () => { alive = false; };
  }, [name, printingId, listTick, refreshUserData, select]);

  // The selected printing's own row: rules text, faces, artist. One primary-key read, cached.
  useEffect(() => {
    if (!name || !selectedId) return;
    if (printingsRef.current.find(p => p.id === selectedId)?.full) return;
    let alive = true;
    setDetailFailed(false);
    void fetchPrinting(selectedId).then(p => {
      if (!alive) return;
      if (!p || p.name !== name) { setDetailFailed(true); return; }
      setPrintings(prev => (prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [p, ...prev]));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [name, selectedId, detailTick]);

  // The picture check starts only once the page is complete, so it never competes
  // with what the person is waiting for, and stops if the sheet closes or the card changes.
  useEffect(() => {
    // Nothing to gain once the person has chosen: skip the downloads entirely.
    if (!name || !scan || listState !== 'ready' || userPicked.current) return;
    let alive = true;
    void compareScanToPrintings(scan.photoUri, scan.candidates, () => alive && !userPicked.current).then(r => { if (alive && r) setArt({ name, scan, result: r }); });
    return () => { alive = false; };
  }, [name, scan, listState]);

  // Quietly move to the picture's winner, but never over a choice the person made or a form they opened.
  // Coverage is judged against the LIVE list, so a printing the offline catalog never knew blocks the switch.
  useEffect(() => {
    // Art from another scan of the same name is as stale as art from another card.
    const target = artSwitchNow({
      name, artName: art && art.scan === scan ? art.name : null,
      all: listState === 'ready' ? printings.map(toPrinting) : [], art: art?.result ?? null,
      userPicked: userPicked.current, adding, footerGuess: !!printingId,
    });
    if (!name || !target || target.id === selectedRef.current) return;
    select(target.id);
    setFaceIndex(0); setExtras({ state: 'idle' });
    setArtNote(`Matched to ${target.setCode.toUpperCase()} #${target.collectorNumber} by artwork`);
    void refreshUserData(name, printings.map(p => p.id), target.id);
  }, [art, listState, printings, adding, name, scan, printingId, select, refreshUserData]);

  function startAdding() {
    if (!selected) return;
    userPicked.current = true;
    const last = app.lastUsedDraft;
    setFinish(last && selected.finishes.includes(last.finish) ? last.finish : (selected.finishes[0] ?? 'nonfoil'));
    setCondition(last?.condition ?? 'NM');
    setLanguage(last?.language ?? 'en');
    setLocation(last && app.locations.some(l => l.id === last.location_id) ? last.location_id : null);
    setQuantity('1');
    operationId.current = Crypto.randomUUID();
    setStatus(null);
    setAdding(true);
  }

  // Choosing another printing invalidates the form's finish and its operation.
  function choosePrinting(p: CardPrinting) {
    userPicked.current = true;
    setArtNote(null);
    select(p.id);
    setFaceIndex(0);
    setExtras({ state: 'idle' });
    if (adding) { setFinish(p.finishes.includes(finish) ? finish : (p.finishes[0] ?? 'nonfoil')); operationId.current = Crypto.randomUUID(); }
  }

  async function confirmAdd() {
    if (!selected || !app.userId || busy) return;
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) { setStatus({ kind: 'error', text: 'Quantity must be a whole number of at least 1.' }); return; }
    if (!writer) { setStatus({ kind: 'error', text: 'Sign in to Upkeep before saving.' }); return; }
    setBusy(true); setStatus(null);
    try {
      if (!confirm.current) confirm.current = new ConfirmScan(writer);
      const draft = { card_id: selected.id, condition, finish, language, quantity: qty, location_id: location, notes: null };
      const result = await confirm.current.save({ operationId: operationId.current ?? Crypto.randomUUID(), draft }, toPrinting(selected));
      app.setLastUsedDraft({ finish, condition, language, location_id: location });
      app.addRecent(`${selected.name} · ${selected.setCode.toUpperCase()} #${selected.collectorNumber}`);
      operationId.current = null;
      setAdding(false);
      setStatus({ kind: 'ok', text: `Added ${qty} × ${selected.name}. You now have ${result.quantity} in that stack.` });
      onChanged?.();
      if (name) void refreshUserData(name, printings.map(p => p.id), selected.id);
    } catch (e) {
      // Same operation id stays, so pressing Add again retries safely.
      setStatus({ kind: 'error', text: errorMessage(e) });
    } finally { setBusy(false); }
  }

  async function wishList() {
    if (!selected || !app.userId || busy) return;
    userPicked.current = true;
    setBusy(true); setStatus(null);
    try {
      await addToWishList(app.userId, selected.id);
      setStatus({ kind: 'ok', text: `Added ${selected.name} to your wish list.` });
      if (name) void refreshUserData(name, printings.map(p => p.id), selected.id);
    } catch (e) { setStatus({ kind: 'error', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  const faces = selected?.faces ?? [];
  // Two faces with their own art flip; several faces on one image (split,
  // adventure) are shown together under the single picture.
  const flippable = faces.length >= 2 && faces.every(f => !!f.image);
  const face = faces[Math.min(faceIndex, Math.max(faces.length - 1, 0))];
  const shownFaces = flippable ? (face ? [face] : []) : faces;
  const artUri = flippable ? face?.image ?? null : selected?.image ?? null;

  async function loadExtras() {
    if (!selected || extras.state === 'loading') return;
    setExtras({ state: 'loading' });
    try { setExtras({ state: 'ready', data: await fetchScryfallExtras(selected.id) }); }
    catch { setExtras({ state: 'error' }); }
  }

  const isFoilFinish = (f?: string | null) => f === 'foil' || f === 'etched';
  // Foil shows for a copy you own in foil or while adding a foil copy.
  // A foil-only printing has no plain version to compare against, so it shows foil by default.
  const foilOnly = !!selected && selected.finishes.length > 0 && selected.finishes.every(f => isFoilFinish(f));
  const foilShown = isFoilFinish(ownedFinish) || (adding && isFoilFinish(finish)) || foilOnly;

  const imageWidth = Math.min(width - space.xxl * 2, 340);
  const variants = selected ? priceVariants(selected) : [];
  const knownFinish = selected ? knownFinishOf(selected, ownedFinish, adding, finish) : null;
  // The headline is the variant matching the known finish; otherwise the plain
  // one, since that is what most people mean by "the price of this card".
  const headline = variants.find(v => v.finish === knownFinish) ?? variants.find(v => v.finish === 'nonfoil') ?? variants[0] ?? null;

  return (
    <Modal transparent visible={!!name} animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <View style={styles.root}>
        {/* Hidden from screen readers: the sheet's own Close button is the one they should find. */}
        <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.scrim, { opacity: y.interpolate({ inputRange: [0, windowHeight], outputRange: [1, 0], extrapolate: 'clamp' }) }]}>
          <Pressable accessible={false} style={styles.scrimFill} onPress={requestClose} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { top: insets.top + space.md, bottom: keyboardHeight, transform: [{ translateY: y }] }]}>
        {/* The drag zone: the grabber and the whole top bar, so a pull anywhere along the top edge closes the sheet. */}
        <View style={styles.topBar} {...dragZone.panHandlers}>
          <View style={styles.grabber} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={requestClose} hitSlop={8} style={styles.close}>
            <Ionicons name="close" size={26} color={text.primary} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={text.secondary} style={styles.spinner} /> : loadError ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{loadError}</Text>
            <Button secondary label="Try again" onPress={() => { setLoadError(null); setLoading(true); setListTick(t => t + 1); }} />
          </View>
        ) : selected && (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xxxl }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} onScrollEndDrag={onScrollEndDrag} scrollEventThrottle={16}>
            {!!artNote && (
              <View style={styles.artNote} accessibilityRole="alert">
                <Text style={styles.artNoteText}>{artNote}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setArtNote(null)} hitSlop={10}>
                  <Ionicons name="close" size={16} color={text.secondary} />
                </Pressable>
              </View>
            )}
            <FoilArt uri={artUri} width={imageWidth} height={imageWidth / CARD_ASPECT} foil={foilShown} />
            {flippable && (
              <Pressable accessibilityRole="button" accessibilityLabel="Flip card" onPress={() => setFaceIndex(i => (i + 1) % faces.length)} style={styles.flip}>
                <Ionicons name="sync-outline" size={18} color={text.primary} />
                <Text style={styles.flipText}>Flip</Text>
              </Pressable>
            )}

            {shownFaces.map((f, i) => (
              <View key={`${f.name}-${i}`} style={styles.block}>
                <View style={styles.titleRow}>
                  <Text style={styles.name}>{f.name}</Text>
                  <ManaCost cost={f.manaCost} size={18} />
                </View>
                {i === 0 && !!selected.flavorName && <Text style={styles.muted}>Printed as “{selected.flavorName}”</Text>}
                {i === 0 && (
                  <View style={styles.price} accessibilityLabel={headline ? `Price ${money(headline.value)}` : 'No price on record'}>
                    {headline ? (
                      <>
                        <Text style={styles.priceValue}>{money(headline.value)}</Text>
                        <View style={styles.priceChips}>
                          {variants.map(v => (
                            <View key={v.finish} style={[styles.priceChip, v.finish === headline.finish && styles.priceChipOn]}>
                              <Text style={[styles.priceChipText, v.finish === headline.finish && styles.priceChipTextOn]}>{v.label} {money(v.value)}</Text>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.priceNone}>No price on record</Text>
                        <Text style={styles.muted}>Scryfall has no price for this printing.</Text>
                      </>
                    )}
                    <Text style={styles.muted}>Scryfall estimate, for reference only.</Text>
                  </View>
                )}
                {!!f.typeLine && <Text style={styles.typeLine}>{f.typeLine}</Text>}
                {!!f.oracleText && <Text style={styles.oracle}>{f.oracleText}</Text>}
                {!!(f.power && f.toughness) && <Text style={styles.stats}>{f.power}/{f.toughness}</Text>}
                {!!f.loyalty && <Text style={styles.stats}>Loyalty {f.loyalty}</Text>}
                {!!f.flavorText && <Text style={styles.flavor}>{f.flavorText}</Text>}
              </View>
            ))}

            {!selected.full && (detailFailed
              ? (
                <View style={styles.block}>
                  <Text style={styles.muted}>{LOAD_FAILED}</Text>
                  <Button secondary label="Try again" onPress={() => setDetailTick(t => t + 1)} />
                </View>
              )
              : <Text style={styles.muted}>Loading card text…</Text>)}

            {status && <Text style={[styles.status, status.kind === 'error' ? styles.statusError : styles.statusOk]} accessibilityRole="alert">{status.text}</Text>}

            {!adding ? (
              <View style={styles.actions}>
                <Button label="Add to collection" onPress={startAdding} disabled={busy || !app.userId || selected.finishes.length === 0} />
                <Button secondary label={busy ? 'Working…' : 'Add to wish list'} onPress={() => void wishList()} disabled={busy || !app.userId} />
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.formTitle}>Add {selected.setCode.toUpperCase()} #{selected.collectorNumber}</Text>
                <Text style={styles.label}>Finish</Text>
                <Choices values={selected.finishes} selected={finish} disabled={busy} onSelect={v => setFinish(v as Finish)} />
                <Text style={styles.label}>Condition</Text>
                <Choices values={[...CONDITIONS]} selected={condition} disabled={busy} onSelect={v => setCondition(v as Condition)} />
                <Text style={styles.label}>Language</Text>
                <Choices values={[...LANGUAGES]} selected={language} disabled={busy} onSelect={setLanguage} />
                <Text style={styles.label}>Where does it go?</Text>
                <Choices
                  values={['', ...app.locations.map(l => l.id)]}
                  selected={location ?? ''}
                  disabled={busy}
                  onSelect={v => setLocation(v || null)}
                  labels={Object.fromEntries([['', 'Unsorted'], ...app.locations.map(l => [l.id, l.name])])}
                />
                <Text style={styles.label}>Quantity</Text>
                <TextInput accessibilityLabel="Quantity" style={styles.input} value={quantity} onChangeText={t => setQuantity(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} />
                <Button label={busy ? 'Adding…' : 'Add'} onPress={() => void confirmAdd()} disabled={busy} />
                <Button secondary label="Cancel" onPress={() => { setAdding(false); operationId.current = null; }} disabled={busy} />
              </View>
            )}

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>In your collection</Text>
              {ownedState === 'loading' ? <Text style={styles.muted}>Checking your collection…</Text>
                : ownedState === 'error' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={() => { if (name) { setOwnedState('loading'); void refreshUserData(name, printings.map(p => p.id), selectedRef.current); } }} hitSlop={8}>
                    <Text style={styles.muted}>Couldn’t check your copies. <Text style={styles.link}>Try again</Text></Text>
                  </Pressable>
                )
                : owned.length === 0
                ? <Text style={styles.muted}>You don’t own this card yet.</Text>
                : owned.map(s => (
                  <OwnedStackRow
                    key={s.id}
                    stack={s}
                    cardName={name!}
                    printings={printings}
                    onChanged={() => {
                      onChanged?.();
                      if (name) void refreshUserData(name, printings.map(p => p.id), selectedRef.current);
                    }}
                  />
                ))}
              {wanted > 0 && <Text style={styles.line}>On your wish list (×{wanted})</Text>}
            </View>

            {friends && (friends.haveForTrade.length > 0 || friends.want.length > 0) && (
              <View style={styles.block}>
                <Text style={styles.sectionTitle}>Among your friends</Text>
                {friends.haveForTrade.map(f => (
                  <Text key={`h-${f.userId}`} style={styles.line}>{f.username} has {f.quantity} open for trade{f.samePrinting ? '' : ' (a different printing)'}</Text>
                ))}
                {friends.want.map(f => (
                  <Text key={`w-${f.userId}`} style={styles.line}>{f.username} wants {f.quantity}</Text>
                ))}
              </View>
            )}

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>Legality and rulings</Text>
              {extras.state === 'idle' && <Button secondary label="Show legality and rulings" onPress={() => void loadExtras()} />}
              {extras.state === 'loading' && <ActivityIndicator color={text.secondary} />}
              {extras.state === 'error' && (
                <>
                  <Text style={styles.muted}>Couldn’t reach Scryfall just now.</Text>
                  <Button secondary label="Try again" onPress={() => void loadExtras()} />
                </>
              )}
              {extras.state === 'ready' && extras.data && (
                <>
                  <View style={styles.legalGrid}>
                    {FORMATS.map(f => {
                      const l = extras.data!.legalities[f];
                      return (
                        <View key={f} style={styles.legalCell}>
                          <Text style={styles.legalFormat}>{f[0]!.toUpperCase() + f.slice(1)}</Text>
                          <Text style={[styles.legalValue, l === 'legal' ? styles.legalOk : l === 'banned' ? styles.legalBad : undefined]}>{l ? LEGALITY_LABELS[l] : '—'}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {extras.data.rulings.length === 0
                    ? <Text style={styles.muted}>No rulings for this card.</Text>
                    : extras.data.rulings.map((r, i) => (
                      <View key={i} style={styles.ruling}>
                        <Text style={styles.muted}>{r.date}</Text>
                        <Text style={styles.line}>{r.comment}</Text>
                      </View>
                    ))}
                  <Text style={styles.muted}>From Scryfall.</Text>
                </>
              )}
            </View>

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>{listState === 'loading' ? 'Loading printings…' : printings.length === 1 ? '1 printing' : `${printings.length} printings`}</Text>
              {listState === 'error' && (
                <>
                  <Text style={styles.muted}>Couldn’t load the other printings.</Text>
                  <Button secondary label="Try again" onPress={() => setListTick(t => t + 1)} />
                </>
              )}
              <FlatList
                horizontal
                data={printings}
                keyExtractor={p => p.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                // Windowed like the Collection grid (see the details-sheet freeze in mobile.md): a card
                // can have hundreds of printings, and each tile now carries a picture. Fixed-width tiles
                // let the list place every one without measuring.
                initialNumToRender={5}
                maxToRenderPerBatch={5}
                windowSize={5}
                getItemLayout={(_, index) => ({ length: PRINTING_TILE_W + space.sm, offset: (PRINTING_TILE_W + space.sm) * index, index })}
                renderItem={({ item }) => {
                  const on = item.id === selectedId;
                  const thumb = item.imageSmall ?? thumbnailUri(item.image);
                  const finishes = finishSummary(item.finishes);
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityLabel={`${item.setName} number ${item.collectorNumber}${finishes ? `, ${finishes}` : ''}`}
                      accessibilityState={{ selected: on }}
                      onPress={() => choosePrinting(item)}
                      style={[styles.printingTile, on && styles.chipOn]}
                    >
                      {thumb ? <Image source={{ uri: thumb }} style={styles.printingThumb} accessibilityIgnoresInvertColors /> : <View style={[styles.printingThumb, styles.printingThumbEmpty]} />}
                      <Text numberOfLines={1} style={[styles.chipText, on && styles.chipTextOn]}>{item.setCode.toUpperCase()} #{item.collectorNumber}</Text>
                      {!!finishes && <Text numberOfLines={1} style={[styles.printingFinish, on && styles.chipTextOn]}>{finishes}</Text>}
                    </Pressable>
                  );
                }}
              />
              <Text style={styles.line}>{[selected.setName, selected.rarity, selected.releasedAt?.slice(0, 4)].filter(Boolean).join(' · ')}</Text>
              {!!selected.artist && <Text style={styles.muted}>Illustrated by {selected.artist}</Text>}
              {!!selected.scryfallUri && (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(selected.scryfallUri!)} hitSlop={8}>
                  <Text style={styles.link}>View on Scryfall</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        )}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * One owned stack's line in "In your collection", with its "Change
 * printing…" action — mobile parity for backlog item 6 (owner decision:
 * "mobile card details sheet only, no mobile per-copy editor yet"). Mirrors
 * the web row-menu item + RowReprint panel in CollectionTable.tsx.
 */
function OwnedStackRow({ stack, printings, cardName, onChanged }: {
  stack: OwnedStack;
  printings: CardPrinting[];
  cardName: string;
  onChanged(): void;
}) {
  const styles = useStyles();
  const { pendingMove, moveBusy } = useApp();
  const moveDisabled = !!pendingMove || moveBusy;
  const [panel, setPanel] = useState<'reprint' | 'move' | null>(null);
  return (
    <View style={styles.ownedRow}>
      <Text style={styles.line}>{stack.quantity} × {stack.setCode.toUpperCase()} #{stack.collectorNumber} · {stack.condition} · {stack.finish} · {stack.locationName ?? 'Unsorted'}</Text>
      {panel === 'reprint' ? (
        <ReprintPanel
          stack={stack}
          printings={printings}
          cardName={cardName}
          onClose={() => setPanel(null)}
          onChanged={() => { setPanel(null); onChanged(); }}
        />
      ) : panel === 'move' ? (
        <MovePanel
          stack={stack}
          onClose={() => setPanel(null)}
          onChanged={() => { setPanel(null); onChanged(); }}
        />
      ) : (
        <View style={styles.ownedRowActions}>
          <Pressable accessibilityRole="button" onPress={() => setPanel('reprint')} hitSlop={8}>
            <Text style={styles.link}>Change printing…</Text>
          </Pressable>
          {stack.locationType !== 'deck' && (
            <Pressable accessibilityRole="button" disabled={moveDisabled} onPress={() => setPanel('move')} hitSlop={8}>
              <Text style={[styles.link, moveDisabled && styles.linkDisabled]}>Move…</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Moves one owned stack (all or part of it) to a different binder or box,
 * through apply_stack_move via `beginMove` (AppProvider) — the same atomic
 * function the deck page's sleeve/unsleeve picker already uses, but reachable
 * here for the first time from Unsorted or any other non-deck location,
 * which is the product's whole premise (backlog item 6). A sleeved copy is
 * re-filed from the deck page instead (`locationType === 'deck'` hides this
 * action above) — that path also updates the deck's list, which a plain move
 * knows nothing about.
 */
function MovePanel({ stack, onClose, onChanged }: {
  stack: OwnedStack;
  onClose(): void;
  onChanged(): void;
}) {
  const styles = useStyles();
  const app = useApp();
  const destinations = app.locations.filter(l => l.id !== stack.locationId);
  const [destination, setDestination] = useState<string | null>(destinations[0]?.id ?? null);
  const [quantityText, setQuantityText] = useState(String(stack.quantity));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const quantity = Math.max(1, Math.min(stack.quantity, Number.parseInt(quantityText, 10) || 0));

  async function confirm() {
    if (busy || quantity < 1) return;
    setBusy(true);
    setStatus(null);
    try {
      const draft: StackMoveDraft = {
        sourceInstanceId: stack.id,
        cardId: stack.cardId,
        condition: stack.condition as Condition,
        finish: stack.finish as Finish,
        language: stack.language,
        quantity,
        destinationLocationId: destination,
      };
      const destName = destination ? app.locations.find(l => l.id === destination)?.name ?? 'Unsorted' : 'Unsorted';
      const result = await app.beginMove(draft, `Move ${quantity} to ${destName}`);
      setStatus({
        kind: 'ok',
        text: result.replayed
          ? `Moved ${quantity} to ${destName}.`
          : `Moved ${quantity} to ${destName}${result.quantity !== quantity ? ` — merged into a stack already there, now ${result.quantity}` : ''}.`,
      });
      onChanged();
    } catch (e) {
      setStatus({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (destinations.length === 0) {
    return <Text style={styles.muted}>No other binder or box to move it to yet — add one from Locations.</Text>;
  }

  return (
    <View style={styles.reprintPanel}>
      <Text style={styles.label}>Move to…</Text>
      <Choices
        values={['', ...destinations.map(l => l.id)]}
        selected={destination ?? ''}
        disabled={busy}
        onSelect={v => setDestination(v || null)}
        labels={Object.fromEntries([['', 'Unsorted'], ...destinations.map(l => [l.id, l.name])])}
      />
      {stack.quantity > 1 && (
        <>
          <Text style={styles.label}>How many? (of {stack.quantity})</Text>
          <TextInput accessibilityLabel="Quantity to move" style={styles.input} value={quantityText} onChangeText={t => setQuantityText(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} editable={!busy} />
        </>
      )}
      {status && <Text style={[styles.status, status.kind === 'error' ? styles.statusError : styles.statusOk]} accessibilityRole="alert">{status.text}</Text>}
      <View style={styles.actions}>
        <Button label={busy ? 'Moving…' : `Move ${quantity > 1 ? quantity : 'it'}`} onPress={() => void confirm()} disabled={busy || quantity < 1} />
        <Button secondary label="Close" onPress={onClose} disabled={busy} />
      </View>
    </View>
  );
}

/**
 * Corrects which printing one owned stack really is — its own operation id,
 * its own retry through reprintWriter (createReprintWriter over
 * apply_stack_reprint, migration 39), not the add form's ConfirmScan path.
 *
 * `printings` is the sheet's own already-loaded list for this card name (the
 * same fetch the printings strip and the add form use), filtered through
 * isSameCard the same way the web row-menu panel filters its own fetch — the
 * database refuses a different card anyway (migration 39), but offering one
 * and then rejecting it reads worse than never offering it.
 */
function ReprintPanel({ stack, printings, cardName, onClose, onChanged }: {
  stack: OwnedStack;
  printings: CardPrinting[];
  cardName: string;
  onClose(): void;
  onChanged(): void;
}) {
  const styles = useStyles();
  const currentOracleId = printings.find(p => p.id === stack.cardId)?.oracleId ?? printings[0]?.oracleId ?? null;
  const candidates = printings.filter(p => isSameCard(
    { oracle_id: p.oracleId, name: p.name },
    { oracle_id: currentOracleId, name: cardName },
  ));

  const [chosenId, setChosenId] = useState(stack.cardId);
  // Derived from the chosen printing, with an explicit override tagged by
  // which printing it was made for — see RowReprint's own comment on the web
  // for why this is not synced through an effect: that would leave a render
  // where the finish still belongs to the previous printing.
  const [finishChoice, setFinishChoice] = useState<{ printing: string; finish: Finish } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const chosen = candidates.find(p => p.id === chosenId) ?? null;
  const reconciliation = chosen ? reconcileFinish(stack.finish as Finish, chosen.finishes) : null;
  const defaultFinish: Finish =
    reconciliation?.kind === 'keep' ? reconciliation.finish
      : reconciliation?.kind === 'choose' ? reconciliation.options[0]!
      : (stack.finish as Finish);
  const finish = finishChoice?.printing === chosenId ? finishChoice.finish : defaultFinish;

  const currentPrinting = printings.find(p => p.id === stack.cardId) ?? null;
  const oldPrice = priceForFinish(currentPrinting, stack.finish as Finish);
  const newPrice = chosen ? priceForFinish(chosen, finish) : null;
  const priceMoves = oldPrice !== null && newPrice !== null && Math.abs(newPrice - oldPrice) >= 0.01;

  const nothingChanged = chosenId === stack.cardId && finish === stack.finish;

  async function confirm() {
    if (!chosen || busy || !reprintWriter) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await reprintWriter.save({
        operationId: Crypto.randomUUID(),
        draft: {
          sourceInstanceId: stack.id,
          newCardId: chosenId,
          finish,
          quantity: stack.quantity,
          condition: stack.condition as Condition,
          language: stack.language,
          locationId: stack.locationId,
          notes: stack.notes,
        },
      });
      const where = chosen.setName || chosen.setCode.toUpperCase();
      const finishNote = finish === stack.finish ? '' : ` as ${FINISH_LABELS[finish]}`;
      setStatus({
        kind: 'ok',
        text: result.instanceId === stack.id
          ? `Changed ${stack.quantity} × ${chosen.name} to ${where} #${chosen.collectorNumber}${finishNote}.`
          : `Changed ${stack.quantity} × ${chosen.name} to ${where} #${chosen.collectorNumber}${finishNote} — merged into a stack you already had, now ${result.quantity}.`,
      });
      onChanged();
    } catch (e) {
      setStatus({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length <= 1) {
    return <Text style={styles.muted}>This card has only one printing.</Text>;
  }

  return (
    <View style={styles.reprintPanel}>
      <Text style={styles.label}>Which printing is it really? ({candidates.length})</Text>
      <Choices
        values={candidates.map(p => p.id)}
        selected={chosenId}
        disabled={busy}
        onSelect={id => { setChosenId(id); setFinishChoice(null); }}
        labels={Object.fromEntries(candidates.map(p => [p.id, `${p.setCode.toUpperCase()} #${p.collectorNumber}`]))}
      />

      {reconciliation?.kind === 'choose' && (
        <View style={styles.reprintWarning}>
          <Text style={styles.reprintWarningText}>
            {`This printing was never made in ${FINISH_LABELS[reconciliation.from]}. Pick the finish you actually have:`}
          </Text>
          <Choices
            values={reconciliation.options}
            selected={finish}
            disabled={busy}
            labels={FINISH_LABELS}
            onSelect={v => setFinishChoice({ printing: chosenId, finish: v as Finish })}
          />
        </View>
      )}

      {reconciliation?.kind === 'impossible' && (
        <Notice style={styles.statusError}>
          The card database lists no finishes for that printing, so a copy cannot be recorded against it.
        </Notice>
      )}

      {/* Said out loud: a reprint legitimately moves a collection's estimated
          value, and a silent swing reads as a broken valuation rather than a
          consequence of this edit — same reasoning as the web RowReprint. */}
      {priceMoves && (
        <Text style={styles.muted}>{`Estimated value changes from ${money(oldPrice)} to ${money(newPrice)} per copy.`}</Text>
      )}

      {stack.locationType === 'deck' && (
        <Text style={styles.muted}>
          This copy is sleeved in {stack.locationName}. The deck&rsquo;s list keeps naming the printing it asks for; only the card in the box changes.
        </Text>
      )}

      {status && <Text style={[styles.status, status.kind === 'error' ? styles.statusError : styles.statusOk]} accessibilityRole="alert">{status.text}</Text>}

      <View style={styles.actions}>
        <Button
          label={busy ? 'Changing…' : `Change ${stack.quantity > 1 ? `all ${stack.quantity}` : 'it'}`}
          onPress={() => void confirm()}
          disabled={busy || nothingChanged || reconciliation?.kind === 'impossible'}
        />
        <Button secondary label="Close" onPress={onClose} disabled={busy} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim },
  scrimFill: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: surface.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  // Tall enough (about 56pt) to be an easy target for a pull, with the grabber centred and the close button at the right.
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xs, minHeight: 56 },
  grabber: { position: 'absolute', top: space.sm, alignSelf: 'center', left: '50%', marginLeft: -18, width: 36, height: 5, borderRadius: radius.pill, backgroundColor: border.strong },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  spinner: { marginTop: space.xxxl },
  errorBox: { padding: space.xxl, gap: space.lg },
  error: { ...type.body, color: text.primary },
  body: { paddingHorizontal: space.xxl, gap: space.xl, alignItems: 'stretch' },
  block: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  name: { flex: 1, ...type.title, fontSize: 24, lineHeight: 30, color: text.primary },
  typeLine: { ...type.body, color: text.secondary },
  oracle: { ...type.body, color: text.primary },
  stats: { ...type.body, color: text.primary, fontFamily: type.title.fontFamily },
  flavor: { ...type.mort, color: text.secondary },
  muted: { ...type.bodySm, color: text.secondary },
  line: { ...type.bodySm, color: text.primary },
  link: { ...type.bodySm, color: text.primary, textDecorationLine: 'underline', marginTop: space.xs },
  linkDisabled: { color: text.secondary },
  sectionTitle: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  actions: { gap: space.md },
  ownedRow: { gap: space.xs },
  ownedRowActions: { flexDirection: 'row', gap: space.lg },
  reprintPanel: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  reprintWarning: { gap: space.xs, borderLeftWidth: 3, borderLeftColor: accent.DEFAULT, backgroundColor: accent.soft, borderRadius: radius.sm, padding: space.md },
  reprintWarningText: { ...type.bodySm, color: text.primary },
  form: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  formTitle: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  label: { ...type.label, color: text.secondary, marginTop: space.sm },
  input: { height: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...type.body },
  status: { ...type.bodySm, padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  statusOk: { backgroundColor: accent.soft, color: text.primary },
  statusError: { backgroundColor: surface.sunken, color: stateColor.error },
  flip: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: border.strong, marginTop: -space.md },
  flipText: { ...type.label, color: text.primary },
  legalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  legalCell: { width: '48%', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  legalFormat: { ...type.label, color: text.secondary },
  legalValue: { ...type.label, color: text.primary },
  legalOk: { color: stateColor.success },
  legalBad: { color: stateColor.error },
  ruling: { gap: 2, marginTop: space.xs },
  artNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: surface.sunken },
  artNoteText: { ...type.label, flex: 1, color: text.secondary },
  price: { gap: space.xs },
  priceValue: { fontSize: 34, lineHeight: 40, fontFamily: type.title.fontFamily, fontWeight: '700', color: text.primary },
  priceNone: { ...type.title, color: text.secondary },
  priceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  priceChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: border.hairline },
  priceChipOn: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  priceChipText: { ...type.label, color: text.secondary },
  priceChipTextOn: { color: text.onAccent },
  chips: { gap: space.sm },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline },
  chipOn: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  printingTile: { width: PRINTING_TILE_W, padding: space.xs, gap: 2, alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline },
  printingThumb: { width: PRINTING_TILE_W - 2 * space.xs - 2, aspectRatio: 488 / 680, borderRadius: 3 },
  printingThumbEmpty: { backgroundColor: surface.sunken },
  printingFinish: { ...type.label, fontSize: 10, color: text.secondary },
  chipText: { ...type.label, color: text.secondary },
  chipTextOn: { color: text.onAccent },
}));
