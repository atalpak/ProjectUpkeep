import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CONDITIONS, ConfirmScan, FINISHES, LANGUAGES, artSwitchNow, type ArtResult, type Condition, type Finish } from '@upkeep/scan-core';
import { useApp } from '../AppProvider';
import { writer } from '../backend';
import {
  FORMATS, LOAD_FAILED, addToWishList, cachedPrinting, cachedPrintings, fetchFriendActivity, fetchOwned, fetchPrinting, fetchPrintings, fetchScryfallExtras, fetchWantedQuantity,
  pickRepresentative, seedToPrinting, toPrinting,
  type CardPrinting, type CardSeed, type FriendActivity, type Legality, type OwnedStack, type ScryfallExtras,
} from '../cardDetails';
import type { CardDetailsTarget } from '../cardDetailsHost';
import { errorMessage } from '../errors';
import { compareScanToPrintings } from '../printingVerify';
import { makeStyles } from '../preferences';
import { accent, border, radius, space, state as stateColor, surface, text, type } from '../theme';
import { Button, Choices } from './ui';
import { FoilArt } from './FoilArt';
import { ManaCost } from './ManaCost';

const CARD_ASPECT = 488 / 680;

const money = (v: number | null) => (v === null ? null : `$${v.toFixed(2)}`);

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
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const app = useApp();
  const [printings, setPrintings] = useState<CardPrinting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [owned, setOwned] = useState<OwnedStack[]>([]);
  const [wanted, setWanted] = useState(0);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [faceIndex, setFaceIndex] = useState(0);
  const [previewFoil, setPreviewFoil] = useState(false);
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
      setPrintings([]); setListState('loading'); setArt(null); setArtNote(null); setDetailFailed(false);
      return;
    }
    userPicked.current = false;
    const cachedList = cachedPrintings(name);
    const cachedRow = printingId ? cachedPrinting(printingId) : undefined;
    const seedP = seedRef.current && seedRef.current.id === printingId ? seedToPrinting(seedRef.current) : null;
    let initial: CardPrinting[] = [];
    if (cachedList) initial = cachedRow ? cachedList.map(p => (p.id === cachedRow.id ? cachedRow : p)) : cachedList;
    else if (cachedRow) initial = [cachedRow];
    else if (seedP) initial = [seedP];
    const start = initial.find(p => p.id === printingId) ?? (cachedList ? pickRepresentative(initial) : null) ?? initial[0] ?? null;
    select(start?.id ?? null);
    setPrintings(initial); setLoading(initial.length === 0); setLoadError(null); setListState(cachedList ? 'ready' : 'loading'); setDetailFailed(false);
    setOwned([]); setWanted(0); setStatus(null); setAdding(false); setFaceIndex(0); setPreviewFoil(false); setFriends(null); setArt(null); setArtNote(null); setExtras({ state: 'idle' });
    // Owned copies need only the name, so they start now, in parallel with the printing fetches.
    if (start) void refreshUserData(name, initial.map(p => p.id), start.id);
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
    setFaceIndex(0); setPreviewFoil(false); setExtras({ state: 'idle' });
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
    setPreviewFoil(false);
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
      onChanged?.();
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
  // Foil shows for a copy you own in foil, while adding a foil copy, or when asked to preview.
  // A foil-only printing has no plain version to compare against, so it shows foil by default.
  const foilOnly = !!selected && selected.finishes.length > 0 && selected.finishes.every(f => isFoilFinish(f));
  const foilShown = isFoilFinish(ownedFinish) || (adding && isFoilFinish(finish)) || previewFoil || foilOnly;
  const canPreviewFoil = !!selected && !isFoilFinish(ownedFinish) && !adding && !foilOnly && selected.finishes.some(f => isFoilFinish(f));

  const imageWidth = Math.min(width - space.xxl * 2, 340);
  const variants = selected ? priceVariants(selected) : [];
  const knownFinish = selected ? knownFinishOf(selected, ownedFinish, adding, finish) : null;
  // The headline is the variant matching the known finish; otherwise the plain
  // one, since that is what most people mean by "the price of this card".
  const headline = variants.find(v => v.finish === knownFinish) ?? variants.find(v => v.finish === 'nonfoil') ?? variants[0] ?? null;

  return (
    <Modal visible={!!name} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.topBar}>
          <Text style={styles.topTitle} numberOfLines={1}>{name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
            <Ionicons name="close" size={26} color={text.primary} />
          </Pressable>
        </View>

        {loading ? <ActivityIndicator color={text.secondary} style={styles.spinner} /> : loadError ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{loadError}</Text>
            <Button secondary label="Try again" onPress={() => { setLoadError(null); setLoading(true); setListTick(t => t + 1); }} />
          </View>
        ) : selected && (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xxxl }]} keyboardShouldPersistTaps="handled">
            {!!artNote && (
              <View style={styles.artNote} accessibilityRole="alert">
                <Text style={styles.artNoteText}>{artNote}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setArtNote(null)} hitSlop={10}>
                  <Ionicons name="close" size={16} color={text.secondary} />
                </Pressable>
              </View>
            )}
            <FoilArt uri={artUri} width={imageWidth} height={imageWidth / CARD_ASPECT} foil={foilShown} />
            {canPreviewFoil && (
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: previewFoil }} onPress={() => setPreviewFoil(v => !v)} style={[styles.flip, previewFoil && styles.flipOn]}>
                <Ionicons name="sparkles-outline" size={16} color={text.primary} />
                <Text style={styles.flipText}>{previewFoil ? 'Foil preview on' : 'Preview foil'}</Text>
              </Pressable>
            )}
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
              {owned.length === 0
                ? <Text style={styles.muted}>You don’t own this card yet.</Text>
                : owned.map(s => (
                  <Text key={s.id} style={styles.line}>{s.quantity} × {s.setCode.toUpperCase()} #{s.collectorNumber} · {s.condition} · {s.finish} · {s.locationName ?? 'Unsorted'}</Text>
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
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="radio" accessibilityState={{ selected: item.id === selectedId }} onPress={() => choosePrinting(item)} style={[styles.chip, item.id === selectedId && styles.chipOn]}>
                    <Text style={[styles.chipText, item.id === selectedId && styles.chipTextOn]}>{item.setCode.toUpperCase()} #{item.collectorNumber}</Text>
                  </Pressable>
                )}
              />
              <Text style={styles.line}>{selected.setName} · {selected.rarity}{selected.releasedAt ? ` · ${selected.releasedAt.slice(0, 4)}` : ''}</Text>
              {!!selected.artist && <Text style={styles.muted}>Illustrated by {selected.artist}</Text>}
              {!!selected.scryfallUri && (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(selected.scryfallUri!)} hitSlop={8}>
                  <Text style={styles.link}>View on Scryfall</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: surface.canvas },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.md },
  topTitle: { flex: 1, ...type.title, color: text.primary },
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
  sectionTitle: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  actions: { gap: space.md },
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
  flipOn: { backgroundColor: accent.soft, borderColor: accent.DEFAULT },
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
  chipText: { ...type.label, color: text.secondary },
  chipTextOn: { color: text.onAccent },
}));
