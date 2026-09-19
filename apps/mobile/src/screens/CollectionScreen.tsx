import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CONDITIONS } from '@upkeep/scan-core';
import { filterCollection } from '@upkeep/domain';
import { CollectionAuthError, EMPTY_COLLECTION_FILTER, collectionFacetCount, fetchWholeCollection, type CollectionEntry, type CollectionFilter } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, Choices, Notice } from '../components/ui';
import { CardDetails } from '../components/CardDetails';
import { FoilOverlay, useFoilTilt } from '../components/FoilArt';
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

function metaLine(e: CollectionEntry): string {
  const finish = e.finish === 'foil' ? 'Foil' : e.finish === 'etched' ? 'Etched' : null;
  return [`${e.card_set_code.toUpperCase()} #${e.card_collector_number}`, e.condition.toUpperCase(), finish, e.language !== 'en' ? e.language.toUpperCase() : null, e.location_name ?? 'Unsorted']
    .filter(Boolean).join(' · ');
}

function CollectionList({ userId }: { userId: string }) {
  const styles = useStyles();
  const app = useApp();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const { collectionView, setCollectionView } = usePreferences();
  // One motion listener shared by every foil tile, and only while the image view is showing.
  const { tilt: foilTilt } = useFoilTilt(focused && collectionView === 'grid');
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<CollectionFilter>(EMPTY_COLLECTION_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  // The whole collection, loaded once and then searched and filtered right here:
  // typing narrows the list instantly, with no request per keystroke.
  const [all, setAll] = useState<CollectionEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRest, setLoadingRest] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<CollectionEntry | null>(null);
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

  const entries = useMemo(() => filterCollection(all, { ...facets, name: query }), [all, facets, query]);
  const facetCount = collectionFacetCount(facets);
  const filtering = !!query.trim() || facetCount > 0;
  const tile = (width - space.xl * 2 - space.sm * (COLUMNS - 1)) / COLUMNS;

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
        <Pressable accessibilityRole="button" accessibilityLabel={collectionView === 'grid' ? 'Show as list' : 'Show card images'} onPress={() => setCollectionView(collectionView === 'grid' ? 'list' : 'grid')} style={styles.iconButton}>
          <Ionicons name={collectionView === 'grid' ? 'list-outline' : 'grid-outline'} size={20} color={text.primary} />
        </Pressable>
      </View>

      {showFilters && (
        <ScrollView style={styles.filters} contentContainerStyle={styles.filtersBody} keyboardShouldPersistTaps="handled">
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

          {facetCount > 0 && <Button secondary label="Clear filters" onPress={() => setFacets(EMPTY_COLLECTION_FILTER)} />}
        </ScrollView>
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
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading && <Text style={styles.body}>Loading your collection…</Text>}
            {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your collection.</Notice>}
            {!loading && !!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}
            {!loading && !authError && !error && (filtering
              ? <><Text style={styles.body}>Nothing in your collection matches.</Text><Button secondary label="Clear search and filters" onPress={clearAll} /></>
              : <Text style={styles.body}>You don&apos;t own any cards yet. Scan one to get started.</Text>)}
          </View>
        }
        ListFooterComponent={loadingRest && all.length > 0 ? <Text style={styles.body}>Loading the rest of your collection…</Text> : null}
        renderItem={({ item: e }) => collectionView === 'grid' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${e.card_name}, ${e.quantity} owned`} onPress={() => setDetails(e)} style={{ width: tile }}>
            {e.card_image_uri_small
              ? <Image source={{ uri: e.card_image_uri_small }} style={[styles.tileImage, { width: tile, height: tile / CARD_ASPECT }]} />
              : <View style={[styles.tileImage, styles.tileEmpty, { width: tile, height: tile / CARD_ASPECT }]}><Text style={styles.tileName}>{e.card_name}</Text></View>}
            {e.finish !== 'nonfoil' && <FoilOverlay tilt={foilTilt} width={tile} height={tile / CARD_ASPECT} radius={6} strength={1.8} />}
            {e.quantity > 1 && <View style={styles.qtyBadge}><Text style={styles.qtyBadgeText}>×{e.quantity}</Text></View>}
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`${e.card_name}, details`} onPress={() => setDetails(e)} style={styles.row}>
            {e.card_image_uri_small ? <Image source={{ uri: e.card_image_uri_small }} style={styles.thumb} /> : <View style={styles.thumb} />}
            <View style={styles.grow}>
              <Text numberOfLines={1} style={styles.name}>{e.card_name}</Text>
              <Text numberOfLines={1} style={styles.meta}>{metaLine(e)}</Text>
            </View>
            {e.quantity > 1 && <Text style={styles.qty}>×{e.quantity}</Text>}
          </Pressable>
        )}
      />
      <CardDetails name={details?.card_name ?? null} printingId={details?.card_id} ownedFinish={details?.finish} onClose={() => { setDetails(null); void load({ silent: true }); }} />
    </View>
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
  filters: { maxHeight: 340, borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  filtersBody: { padding: space.lg, gap: space.sm },
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
  thumb: { width: 38, height: 53, borderRadius: 4, backgroundColor: surface.sunken },
  grow: { flex: 1, gap: 1 },
  name: { ...typeTokens.body, fontFamily: typeTokens.title.fontFamily, color: text.primary },
  meta: { ...typeTokens.label, color: text.secondary, fontFamily: typeTokens.bodySm.fontFamily },
  qty: { ...typeTokens.title, fontSize: 16, color: text.primary },
  gridRow: { gap: space.sm, marginBottom: space.sm },
  tileImage: { borderRadius: 6, backgroundColor: surface.sunken },
  tileEmpty: { alignItems: 'center', justifyContent: 'center', padding: 6 },
  tileName: { ...typeTokens.label, color: text.secondary, textAlign: 'center' },
  qtyBadge: { position: 'absolute', top: 4, right: 4, minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: accent.DEFAULT },
  qtyBadgeText: { ...typeTokens.label, color: text.onAccent, fontWeight: '800' },
}));
