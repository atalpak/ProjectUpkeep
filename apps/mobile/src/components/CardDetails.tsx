import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CONDITIONS, ConfirmScan, FINISHES, LANGUAGES, needsPrintingConfirm, type Condition, type Finish } from '@upkeep/scan-core';
import { useApp } from '../AppProvider';
import { writer } from '../backend';
import {
  FORMATS, addToWishList, fetchFriendActivity, fetchOwned, fetchPrintings, fetchScryfallExtras, fetchWantedQuantity, pickRepresentative, toPrinting,
  type CardPrinting, type FriendActivity, type Legality, type OwnedStack, type ScryfallExtras,
} from '../cardDetails';
import type { CardDetailsTarget } from '../cardDetailsHost';
import { errorMessage } from '../errors';
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

export function CardDetails({ name, printingId, note, verify, ownedFinish, onClose }: {
  name: string | null;
  /** Open on this printing (e.g. the one you own) instead of the default. */
  printingId?: string | null;
  /** A line shown above the card, e.g. how a scan matched. */
  note?: string;
  /** A scan that could not settle the printing: shows the "Which printing is this?" picker and holds back adding until one is confirmed. */
  verify?: CardDetailsTarget['verify'];
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
  // Until the person confirms a printing the scan could not settle, nothing can be added.
  const [confirmed, setConfirmed] = useState(false);
  const [extras, setExtras] = useState<{ state: 'idle' | 'loading' | 'error' | 'ready'; data?: ScryfallExtras }>({ state: 'idle' });

  const [adding, setAdding] = useState(false);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [condition, setCondition] = useState<Condition>('NM');
  const [language, setLanguage] = useState('en');
  const [location, setLocation] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const operationId = useRef<string | null>(null);
  const confirm = useRef<ConfirmScan | null>(null);

  const selected = printings.find(p => p.id === selectedId) ?? null;
  // The picker gate is "a scan asked to verify and nobody has confirmed", never "options resolved":
  // the offered ids come from the offline catalog and may not exist in the live table
  // (digital filter, the fetch limit), and a gate that needs them would fail open.
  const offeredOptions = verify ? verify.optionIds.map(id => printings.find(p => p.id === id)).filter((p): p is CardPrinting => !!p) : [];
  // A pin was decided against the offline catalog; it only stands if the live list has nothing that catalog missed.
  const needsConfirm = needsPrintingConfirm({ verify, confirmed, liveIds: printings.map(p => p.id) });
  // If none of the offered printings resolve, offer everything that did load.
  const pickerOptions = offeredOptions.length > 0 && !verify?.pinned ? offeredOptions : printings;

  const refreshUserData = useCallback(async (cardName: string, ids: string[], selected: string | null) => {
    if (!app.userId) return;
    const [o, w, f] = await Promise.all([
      fetchOwned(app.userId, cardName),
      fetchWantedQuantity(app.userId, ids).catch(() => 0),
      fetchFriendActivity(app.userId, ids, selected).catch(() => null),
    ]);
    setOwned(o.stacks);
    setWanted(w);
    setFriends(f);
  }, [app.userId]);

  useEffect(() => {
    if (!name) return;
    let alive = true;
    setLoading(true); setLoadError(null); setPrintings([]); setSelectedId(null); setOwned([]); setWanted(0); setStatus(null); setAdding(false); setFaceIndex(0); setPreviewFoil(false); setFriends(null); setConfirmed(false); setExtras({ state: 'idle' });
    void fetchPrintings(name).then(({ printings: list, error }) => {
      if (!alive) return;
      setLoading(false);
      if (error || list.length === 0) {
        setLoadError(verify ? 'Couldn’t load this card’s printings, so the printing can’t be confirmed. Close this and try again.' : (error ?? 'No printings found for this card.'));
        return;
      }
      setPrintings(list);
      // A scan that could not settle the printing pre-selects only its best guess. With no best guess nothing is
      // selected, so the confirm button stays disabled until the person makes a real choice.
      const start = verify
        ? (list.find(p => p.id === (verify.bestId ?? printingId)) ?? null)
        : (list.find(p => p.id === printingId) ?? pickRepresentative(list) ?? list[0]!);
      setSelectedId(start?.id ?? null);
      void refreshUserData(name, list.map(p => p.id), start?.id ?? null);
    });
    return () => { alive = false; };
  }, [name, printingId, verify, refreshUserData]);

  function startAdding() {
    if (!selected) return;
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
    setSelectedId(p.id);
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
      if (name) void refreshUserData(name, printings.map(p => p.id), selected.id);
    } catch (e) {
      // Same operation id stays, so pressing Add again retries safely.
      setStatus({ kind: 'error', text: errorMessage(e) });
    } finally { setBusy(false); }
  }

  async function wishList() {
    if (!selected || !app.userId || busy) return;
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
  // Foil shows for a copy you own in foil, while adding a foil copy, or when asked to preview.
  const foilShown = isFoilFinish(ownedFinish) || (adding && isFoilFinish(finish)) || previewFoil;
  const canPreviewFoil = !!selected && !isFoilFinish(ownedFinish) && !adding && selected.finishes.some(f => isFoilFinish(f));

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

        {loading ? <ActivityIndicator color={text.secondary} style={styles.spinner} /> : loadError ? <Text style={styles.error}>{loadError}</Text> : (selected || needsConfirm) && (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xxxl }]} keyboardShouldPersistTaps="handled">
            {!!note && <Text style={styles.note}>{note}</Text>}
            {needsConfirm && verify && (
              <View style={styles.picker} accessibilityLabel="Which printing is this?">
                <Text style={styles.pickerTitle}>Which printing is this?</Text>
                <Text style={styles.muted}>The scan could not be sure. Tap the one that matches your card, then confirm.</Text>
                <View style={styles.pickerRow}>
                  {!!verify.photoUri && (
                    <View style={styles.pickerCell}>
                      <Image source={{ uri: verify.photoUri }} style={styles.pickerImage} resizeMode="cover" accessibilityLabel="Your scanned card" />
                      <Text style={styles.pickerCaption}>Your card</Text>
                    </View>
                  )}
                  <FlatList
                    horizontal
                    data={pickerOptions}
                    keyExtractor={p => p.id}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.pickerList}
                    renderItem={({ item }) => {
                      const on = item.id === selectedId;
                      return (
                        <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => choosePrinting(item)} style={[styles.pickerCell, on && styles.pickerCellOn]}>
                          {item.imageSmall
                            ? <Image source={{ uri: item.imageSmall }} style={styles.pickerImage} resizeMode="cover" />
                            : <View style={[styles.pickerImage, styles.pickerBlank]} />}
                          <Text style={styles.pickerCaption} numberOfLines={1}>{item.setName}</Text>
                          <Text style={styles.pickerCaption}>#{item.collectorNumber}{item.finishes.length === 1 ? ` · ${item.finishes[0]} only` : ''}</Text>
                          {item.id === verify.bestId && <Text style={styles.pickerBest}>Best guess</Text>}
                        </Pressable>
                      );
                    }}
                  />
                </View>
                <Button label={selected ? `This is ${selected.setCode.toUpperCase()} #${selected.collectorNumber}` : 'Confirm'} onPress={() => setConfirmed(true)} disabled={!selected} />
              </View>
            )}
            {selected && (<>
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

            {status && <Text style={[styles.status, status.kind === 'error' ? styles.statusError : styles.statusOk]} accessibilityRole="alert">{status.text}</Text>}

            {!adding ? (
              <View style={styles.actions}>
                <Button label="Add to collection" onPress={startAdding} disabled={busy || !app.userId || needsConfirm} />
                <Button secondary label={busy ? 'Working…' : 'Add to wish list'} onPress={() => void wishList()} disabled={busy || !app.userId || needsConfirm} />
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
              <Text style={styles.sectionTitle}>{printings.length === 1 ? '1 printing' : `${printings.length} printings`}</Text>
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
            </>)}
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
  error: { ...type.body, color: text.primary, padding: space.xxl },
  body: { paddingHorizontal: space.xxl, gap: space.xl, alignItems: 'stretch' },
  art: { alignSelf: 'center', borderRadius: radius.lg, backgroundColor: surface.sunken },
  artEmpty: { alignItems: 'center', justifyContent: 'center' },
  block: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md },
  name: { flex: 1, ...type.title, fontSize: 24, lineHeight: 30, color: text.primary },
  mana: { ...type.body, color: text.secondary, marginTop: 4 },
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
  note: { ...type.bodySm, color: text.primary, padding: space.md, borderRadius: radius.md, overflow: 'hidden', backgroundColor: accent.soft },
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
  picker: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: accent.DEFAULT },
  pickerTitle: { ...type.title, fontSize: 18, lineHeight: 24, color: text.primary },
  pickerRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  pickerList: { gap: space.sm },
  pickerCell: { width: 96, gap: 2, padding: 4, borderRadius: radius.md, borderWidth: 2, borderColor: 'transparent' },
  pickerCellOn: { borderColor: accent.DEFAULT, backgroundColor: accent.soft },
  pickerImage: { width: 88, height: 88 / CARD_ASPECT, borderRadius: radius.sm, backgroundColor: surface.sunken },
  pickerBlank: { borderWidth: 1, borderColor: border.hairline },
  pickerCaption: { ...type.label, color: text.secondary },
  pickerBest: { ...type.label, color: text.primary, fontWeight: '700' },
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
