import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CONDITIONS } from '@upkeep/scan-core';
import { COLLECTION_SORTS, COLLECTION_SORT_LABELS, entryPrice, filterCollection, formatPrice, sortCollection, type CollectionSort } from '@upkeep/domain';
import { CollectionAuthError, EMPTY_COLLECTION_FILTER, collectionFacetCount, fetchWholeCollection, type CollectionEntry, type CollectionFilter } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { BottomSheet, Button, Choices, EmptyState, Notice } from '../components/ui';
import { useSearchOverlay } from '../searchOverlay';
import { CardDetails } from '../components/CardDetails';
import type { CardSeed } from '../cardDetails';
import { FoilOverlay, useFoilTilt } from '../components/FoilArt';
import { FlipBadge } from '../components/FlipBadge';
import { useCardFace } from '../hooks/useCardFace';
import { border, radius, space, surface, text, type as typeTokens, accent } from '../theme';
import { makeStyles, usePreferences } from '../preferences';

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;
const COLOR_NAMES: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const RARITIES = ['', 'common', 'uncommon', 'rare', 'mythic'];
const RARITY_LABELS: Record<string, string> = { '': 'Any', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };
const FINISHES = ['', 'nonfoil', 'foil', 'etched'];
const FINISH_LABELS: Record<string, string> = { '': 'Any', nonfoil: 'Non-foil', foil: 'Foil', etched: 'Etched' };
const COLOR_MODE_LABELS: Record<string, string> = { all: 'Has all', any: 'Has any' };
const COLUMNS = 3;
const CARD_ASPECT = 488 / 680;

// Browse of the signed-in user's own collection. See src/collection.ts for the
// query and why it targets the collection_entries view and always scopes on the owner.
export function CollectionScreen() {
  const { userId } = useApp();
  if (!userId) return null; // App.tsx only mounts the tab navigator once signed in.
  return <CollectionList userId={userId} />;
}

/** What the row already says about the printing, so the details sheet can paint before any request. */
function seedOf(e: CollectionEntry): CardSeed {
  return {
    id: e.card_id, name: e.card_name, setCode: e.card_set_code, collectorNumber: e.card_collector_number, rarity: e.card_rarity, typeLine: e.card_type_line,
    image: e.card_image_uri, imageSmall: e.card_image_uri_small, priceUsd: e.card_price_usd, priceUsdFoil: e.card_price_usd_foil, priceUsdEtched: e.card_price_usd_etched,
  };
}

function metaLine(e: CollectionEntry): string {
  const finish = e.finish === 'foil' ? 'Foil' : e.finish === 'etched' ? 'Etched' : null;
  return [`${e.card_set_code.toUpperCase()} #${e.card_collector_number}`, e.condition.toUpperCase(), finish, e.language !== 'en' ? e.language.toUpperCase() : null, e.location_name ?? 'Unsorted']
    .filter(Boolean).join(' · ');
}

// Slower than the sheet's own tilt: a grid can mount dozens of overlays, each moved from the JS thread.
const COLLECTION_TILT_INTERVAL_MS = 100;

function CollectionList({ userId }: { userId: string }) {
  const styles = useStyles();
  const app = useApp();
  const navigation = useNavigation<{ navigate(page: 'Scan'): void }>();
  const openSearch = useSearchOverlay().open;
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const { collectionView, setCollectionView, collectionSort, setCollectionSort } = usePreferences();
  // One motion listener shared by every foil tile and row thumbnail, only while this tab is showing.
  // Paused while the details sheet is open: the tiles under it are invisible, and a second tilt
  // listener driving every mounted foil tile at 30Hz on the JS thread (plus the sheet's own) is what froze
  // the app on opening a foil card.
  const [details, setDetails] = useState<CollectionEntry | null>(null);
  const { tilt: foilTilt } = useFoilTilt(focused && !details && (collectionView === 'grid' || collectionView === 'list'), undefined, COLLECTION_TILT_INTERVAL_MS);
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<CollectionFilter>(EMPTY_COLLECTION_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [showSort, setShowSort] = useState(false);
  // The whole collection, loaded once and then searched and filtered right here:
  // typing narrows the list instantly, with no request per keystroke.
  const [all, setAll] = useState<CollectionEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRest, setLoadingRest] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  // Set when the sheet added something, so closing reloads the collection only then (a full reload is 20 heavy pages).
  const dirty = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const requestId = useRef(0);
  const lastLoaded = useRef(0);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const id = ++requestId.current;
    if (!opts.silent) setLoading(true);
    setLoadingRest(true); setError(''); setAuthError(false);
    try {
      // Show the first rows as soon as they arrive; the rest keep filling in.
      await fetchWholeCollection(userId, (rows, count) => {
        if (!alive.current || id !== requestId.current) return;
        setAll(rows); setTotal(count); setLoading(false);
      });
      lastLoaded.current = Date.now();
    } catch (e) {
      if (!alive.current || id !== requestId.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current && id === requestId.current) { setLoading(false); setLoadingRest(false); }
    }
  }, [userId]);

  // Coming back to the tab refreshes quietly (a card may have been added from
  // Scan or Search), but not on every glance: only if the copy is a while old.
  useEffect(() => {
    if (!focused) return;
    if (lastLoaded.current === 0 || Date.now() - lastLoaded.current > 20_000) void load({ silent: lastLoaded.current !== 0 });
  }, [focused, load]);

  // Filter first, sort what is left: the load is already name-ordered, so the
  // default sort is a no-op re-order rather than a second pass over everything.
  const entries = useMemo(() => sortCollection(filterCollection(all, { ...facets, name: query }), collectionSort), [all, facets, query, collectionSort]);
  const facetCount = collectionFacetCount(facets);
  const filtering = !!query.trim() || facetCount > 0;
  const tile = (width - space.xl * 2 - space.sm * (COLUMNS - 1)) / COLUMNS;

  // Stable between renders that only open or close the sheet, so the rows are not re-rendered by it.
  const renderItem = useCallback(({ item: e }: { item: CollectionEntry }) => (
    collectionView === 'grid'
      ? <CollectionTile entry={e} tile={tile} tilt={foilTilt} onOpen={setDetails} />
      : <CollectionRow entry={e} tilt={foilTilt} onOpen={setDetails} />
  ), [collectionView, tile, foilTilt]);

  function toggleColor(c: (typeof COLORS)[number]) {
    setFacets(f => ({ ...f, colorless: false, colors: f.colors.includes(c) ? f.colors.filter(x => x !== c) : [...f.colors, c] }));
  }
  function clearAll() { setQuery(''); setFacets(EMPTY_COLLECTION_FILTER); }

  const header = (
    <View style={styles.top}>
      <View style={styles.searchRow}>
        <View style={styles.field}>
          <Ionicons name="search" size={18} color={text.secondary} />
          <TextInput accessibilityLabel="Search your collection" style={styles.input} value={query} onChangeText={setQuery} placeholder="Search your collection" placeholderTextColor={text.secondary} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
          {!!query && <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={text.secondary} /></Pressable>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={facetCount ? `Filters, ${facetCount} active` : 'Filters'} accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(v => !v)} style={[styles.iconButton, (showFilters || facetCount > 0) && styles.iconButtonOn]}>
          <Ionicons name="options-outline" size={20} color={text.primary} />
          {facetCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{facetCount}</Text></View>}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Sort, ${COLLECTION_SORT_LABELS[collectionSort]}`} accessibilityState={{ expanded: showSort }} onPress={() => setShowSort(v => !v)} style={[styles.iconButton, (showSort || collectionSort !== 'name') && styles.iconButtonOn]}>
          <Ionicons name="swap-vertical" size={20} color={text.primary} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={collectionView === 'grid' ? 'Show as list' : 'Show card images'} onPress={() => setCollectionView(collectionView === 'grid' ? 'list' : 'grid')} style={styles.iconButton}>
          <Ionicons name={collectionView === 'grid' ? 'list-outline' : 'grid-outline'} size={20} color={text.primary} />
        </Pressable>
      </View>

      {showSort && (
        <View style={styles.sortPanel}>
          <Choices values={[...COLLECTION_SORTS]} selected={collectionSort} labels={COLLECTION_SORT_LABELS} onSelect={v => { setCollectionSort(v as CollectionSort); setShowSort(false); }} />
        </View>
      )}

      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your collection.</Notice>}
      {!loading && !!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}
      {!loading && !authError && !error && all.length > 0 && (
        <Text style={styles.count}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}{filtering ? ' match' : ''}{loadingRest && total !== null && all.length < total ? ` · loaded ${all.length} of ${total}` : ''}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.page}>
      <FlatList
        key={collectionView}
        data={entries}
        keyExtractor={e => e.id}
        numColumns={collectionView === 'grid' ? COLUMNS : 1}
        columnWrapperStyle={collectionView === 'grid' ? styles.gridRow : undefined}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // Every mounted foil tile is animated from the JS thread, so keep the mounted window small
        // (the default keeps ~10 screens of rows alive and grows as you scroll).
        windowSize={5}
        maxToRenderPerBatch={8}
        initialNumToRender={12}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading && <Text style={styles.body}>Loading your collection…</Text>}
            {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your collection.</Notice>}
            {!loading && !!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}
            {!loading && !authError && !error && (filtering
              ? <><Text style={styles.body}>Nothing in your collection matches.</Text><Button secondary label="Clear search and filters" onPress={clearAll} /></>
              : (
                <EmptyState title="Your collection starts here" body="Scan a card with your camera, or look one up and add it by hand.">
                  <Button label="Scan a card" onPress={() => navigation.navigate('Scan')} />
                  <Button secondary label="Search for a card" onPress={openSearch} />
                </EmptyState>
              ))}
          </View>
        }
        ListFooterComponent={loadingRest && all.length > 0 ? <Text style={styles.body}>Loading the rest of your collection…</Text> : null}
        renderItem={renderItem}
      />
      <BottomSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filters"
        footer={
          <View style={styles.filterFooter}>
            {facetCount > 0 && <Button secondary label="Reset" onPress={() => setFacets(EMPTY_COLLECTION_FILTER)} />}
            <View style={styles.filterFooterPrimary}>
              <Button label={`Show ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`} onPress={() => setShowFilters(false)} />
            </View>
          </View>
        }
      >
        <Text style={styles.groupLabel}>Colors</Text>
        <View style={styles.colorRow}>
          {COLORS.map(c => {
            const on = facets.colors.includes(c);
            return (
              <Pressable key={c} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={COLOR_NAMES[c]} onPress={() => toggleColor(c)} style={[styles.colorChip, on && styles.colorChipOn]}>
                <Text style={[styles.colorText, on && styles.colorTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: facets.colorless }} onPress={() => setFacets(f => ({ ...f, colorless: !f.colorless, colors: [] }))} style={[styles.pill, facets.colorless && styles.colorChipOn]}>
            <Text style={[styles.colorText, facets.colorless && styles.colorTextOn]}>Colorless</Text>
          </Pressable>
        </View>
        {facets.colors.length > 1 && <Choices values={['all', 'any']} selected={facets.colorMode} labels={COLOR_MODE_LABELS} onSelect={v => setFacets(f => ({ ...f, colorMode: v as 'all' | 'any' }))} />}

        <Text style={styles.groupLabel}>Where it is</Text>
        <Choices values={['', 'unsorted', ...app.locations.map(l => l.id)]} selected={facets.location} onSelect={v => setFacets(f => ({ ...f, location: v }))}
          labels={Object.fromEntries([['', 'Anywhere'], ['unsorted', 'Unsorted'], ...app.locations.map(l => [l.id, l.name])])} />

        <Text style={styles.groupLabel}>Rarity</Text>
        <Choices values={RARITIES} selected={facets.rarity} labels={RARITY_LABELS} onSelect={v => setFacets(f => ({ ...f, rarity: v }))} />
        <Text style={styles.groupLabel}>Finish</Text>
        <Choices values={FINISHES} selected={facets.finish} labels={FINISH_LABELS} onSelect={v => setFacets(f => ({ ...f, finish: v }))} />
        <Text style={styles.groupLabel}>Condition</Text>
        <Choices values={['', ...CONDITIONS]} selected={facets.condition} labels={{ '': 'Any' }} onSelect={v => setFacets(f => ({ ...f, condition: v }))} />

        <Text style={styles.groupLabel}>Type</Text>
        <TextInput accessibilityLabel="Type" style={styles.textInput} value={facets.type} onChangeText={t => setFacets(f => ({ ...f, type: t }))} placeholder="e.g. creature" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} />
        <Text style={styles.groupLabel}>Set code</Text>
        <TextInput accessibilityLabel="Set code" style={styles.textInput} value={facets.set} onChangeText={t => setFacets(f => ({ ...f, set: t }))} placeholder="e.g. fdn" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} maxLength={8} />
      </BottomSheet>
      <CardDetails
        name={details?.card_name ?? null}
        printingId={details?.card_id}
        seed={details ? seedOf(details) : null}
        ownedFinish={details?.finish}
        onChanged={() => { dirty.current = true; }}
        onClose={() => { setDetails(null); if (dirty.current) { dirty.current = false; void load({ silent: true }); } }}
      />
    </View>
  );
}

type FoilTilt = ReturnType<typeof useFoilTilt>['tilt'];

// A card that flips gets its own state here, per tile: leaving the tab or the list recycling the
// tile puts it back on its front (see useCardFace). The badge is a sibling of the tile's own
// Pressable's content, so a press flips instead of opening the details.
function CollectionTile({ entry: e, tile, tilt, onOpen }: { entry: CollectionEntry; tile: number; tilt: FoilTilt; onOpen(e: CollectionEntry): void }) {
  const styles = useStyles();
  const face = useCardFace({ name: e.card_name, layout: e.card_layout, image: e.card_image_uri, imageSmall: e.card_image_uri_small }, 'small');
  const name = face.name ?? e.card_name;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}, ${e.quantity} owned`} onPress={() => onOpen(e)} style={{ width: tile }}>
      {face.image
        ? <Image source={{ uri: face.image }} onError={face.onImageError} style={[styles.tileImage, { width: tile, height: tile / CARD_ASPECT }]} />
        : <View style={[styles.tileImage, styles.tileEmpty, { width: tile, height: tile / CARD_ASPECT }]}><Text style={styles.tileName}>{name}</Text></View>}
      {e.finish !== 'nonfoil' && <FoilOverlay tilt={tilt} width={tile} height={tile / CARD_ASPECT} radius={6} strength={1.05} />}
      {e.quantity > 1 && <View style={styles.qtyBadge}><Text style={styles.qtyBadgeText}>×{e.quantity}</Text></View>}
      {face.canFlip && <FlipBadge onPress={face.flip} otherName={face.otherName} />}
    </Pressable>
  );
}

function CollectionRow({ entry: e, tilt, onOpen }: { entry: CollectionEntry; tilt: FoilTilt; onOpen(e: CollectionEntry): void }) {
  const styles = useStyles();
  const face = useCardFace({ name: e.card_name, layout: e.card_layout, image: e.card_image_uri, imageSmall: e.card_image_uri_small }, 'small');
  const name = face.name ?? e.card_name;
  // A display-only Scryfall estimate for this exact copy's finish, same rule
  // the web collection table and the dashboard's total already use
  // (`entryPrice`, `@upkeep/domain`) -- never a valuation the app claims to be exact.
  const price = entryPrice(e);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name}, details`} onPress={() => onOpen(e)} style={styles.row}>
      <View style={styles.thumb}>
        {face.image ? <Image source={{ uri: face.image }} onError={face.onImageError} style={styles.thumbImage} /> : null}
        {e.finish !== 'nonfoil' && <FoilOverlay tilt={tilt} width={38} height={53} radius={4} strength={1.25} />}
        {face.canFlip && <FlipBadge onPress={face.flip} otherName={face.otherName} size={20} corner="bottom-right" />}
      </View>
      <View style={styles.grow}>
        <Text numberOfLines={1} style={styles.name}>{name}</Text>
        <Text numberOfLines={1} style={styles.meta}>{metaLine(e)}</Text>
      </View>
      <View style={styles.trailing}>
        {e.quantity > 1 && <Text style={styles.qty}>×{e.quantity}</Text>}
        <Text style={styles.price}>{formatPrice(price)}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingBottom: 40 },
  top: { gap: space.sm, paddingTop: space.sm, paddingBottom: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  input: { flex: 1, ...typeTokens.body, color: text.primary, paddingVertical: 0 },
  iconButton: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  iconButtonOn: { borderColor: accent.DEFAULT, backgroundColor: accent.soft },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: accent.DEFAULT },
  badgeText: { ...typeTokens.label, color: text.onAccent },
  sortPanel: { padding: space.md, borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  filterFooter: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  filterFooterPrimary: { flex: 1 },
  groupLabel: { ...typeTokens.label, color: text.secondary, marginTop: space.sm },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  colorChip: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: border.strong },
  pill: { height: 38, paddingHorizontal: space.md, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: border.strong },
  colorChipOn: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  colorText: { ...typeTokens.bodySm, color: text.primary, fontWeight: '700' },
  colorTextOn: { color: text.onAccent },
  textInput: { height: 40, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...typeTokens.body },
  count: { ...typeTokens.label, color: text.secondary },
  empty: { paddingTop: space.lg, gap: space.md },
  body: { ...typeTokens.bodySm, color: text.secondary },
  // Compact row: a small thumbnail, name, one line of detail, the quantity on the right.
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  thumb: { width: 38, height: 53, borderRadius: 4, backgroundColor: surface.sunken, overflow: 'hidden' },
  thumbImage: { width: 38, height: 53 },
  grow: { flex: 1, gap: 1 },
  name: { ...typeTokens.body, fontFamily: typeTokens.title.fontFamily, color: text.primary },
  meta: { ...typeTokens.label, color: text.secondary, fontFamily: typeTokens.bodySm.fontFamily },
  trailing: { alignItems: 'flex-end', gap: 1 },
  qty: { ...typeTokens.title, fontSize: 16, color: text.primary },
  price: { ...typeTokens.label, color: text.secondary },
  gridRow: { gap: space.sm, marginBottom: space.sm },
  tileImage: { borderRadius: 6, backgroundColor: surface.sunken },
  tileEmpty: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  tileName: { ...typeTokens.label, color: text.secondary, textAlign: 'center' },
  qtyBadge: { position: 'absolute', top: 4, right: 4, minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: accent.DEFAULT },
  qtyBadgeText: { ...typeTokens.label, color: text.onAccent, fontWeight: '800' },
}));
