import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, FlatList, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS, EMPTY_ADVANCED_FILTER, advancedFacetCount, isAdvancedFilterActive, looksLikeScryfallSyntax, parseScryfallQuery,
  type AdvancedCardFilter, type Color, type ColorMode, type NumericOp,
} from '@upkeep/domain';
import { searchCards, type CardSearchResult } from '../cardSearch';
import { recordRecentSearch, readRecentSearches } from '../recentSearches';
import { useApp } from '../AppProvider';
import { Button, Choices } from './ui';
import { ManaSymbol } from './ManaCost';
import { CardDetails } from './CardDetails';
import { FlipBadge } from './FlipBadge';
import { useCardFace } from '../hooks/useCardFace';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { makeStyles } from '../preferences';
import { accent, border, radius, scrim, space, surface, text, type } from '../theme';

const COLOR_NAMES: Record<Color, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };
const COLOR_MODE_LABELS: Record<string, string> = { all: 'Includes', any: 'Any of', exactly: 'Exactly', atMost: 'At most' };
const CMC_OPS: NumericOp[] = ['eq', 'gte', 'lte'];
const CMC_LABELS: Record<string, string> = { eq: '=', gte: '≥', lte: '≤' };
const RARITIES = ['', 'common', 'uncommon', 'rare', 'mythic'];
const RARITY_LABELS: Record<string, string> = { '': 'Any', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };
const DEBOUNCE_MS = 450;
// The filters panel's ceiling; on a short screen it is held to 40% of the height instead,
// so the results below it never disappear behind an open panel.
const FILTERS_MAX_HEIGHT = 320;
const CARD_ASPECT = 488 / 680;
const COLUMNS = 3;

type Facets = Omit<AdvancedCardFilter, 'name'>;
const EMPTY_FACETS: Facets = { ...EMPTY_ADVANCED_FILTER };

/**
 * Card search: a bar that drops in from the top and opens into a full-height
 * search page -- name (or Scryfall-style syntax) plus a Filters panel, over
 * every card Magic has, the same idea as the web app's Advanced Search.
 */
export function SearchOverlay({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { userId } = useApp();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const input = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [cmcText, setCmcText] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [state, setState] = useState<{ results: CardSearchResult[]; total: number; capped: boolean; error: string | null; loading: boolean; ran: boolean }>(
    { results: [], total: 0, capped: false, error: null, loading: false, ran: false },
  );
  const [zoomed, setZoomed] = useState<CardSearchResult | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      void readRecentSearches().then(setRecent);
      Animated.timing(progress, { toValue: 1, duration: reducedMotion ? 0 : 280, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(() => input.current?.focus());
    } else {
      Keyboard.dismiss();
      Animated.timing(progress, { toValue: 0, duration: reducedMotion ? 0 : 220, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => {
          if (!finished) return;
          setMounted(false);
          setQuery(''); setFacets(EMPTY_FACETS); setCmcText(''); setShowFilters(false); setOwnedOnly(false); setZoomed(null);
          requestId.current += 1;
          setState({ results: [], total: 0, capped: false, error: null, loading: false, ran: false });
        });
    }
  }, [visible, reducedMotion, progress]);

  // Typed syntax ("c:r cmc<=2 goblin") speaks for the whole query, exactly as
  // on the web; otherwise the box is the name and the panel supplies the rest.
  const parsed = useMemo(() => (looksLikeScryfallSyntax(query) ? parseScryfallQuery(query) : null), [query]);
  const filter: AdvancedCardFilter = useMemo(() => parsed?.filter ?? { ...facets, name: query.trim() }, [parsed, facets, query]);
  // A bare name needs two characters; any facet is enough on its own -- and
  // "owned only" is itself enough to run a browse-what-I-have search with no
  // name or filter at all.
  const runnable = isAdvancedFilterActive({ ...filter, name: '' }) || filter.name.trim().length >= 2 || ownedOnly;

  useEffect(() => {
    if (!visible) return;
    const id = ++requestId.current;
    if (!runnable) { setState({ results: [], total: 0, capped: false, error: null, loading: false, ran: false }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      void searchCards(filter, 60, { ownedOnly, userId: userId ?? undefined }).then(r => {
        if (id === requestId.current) setState({ results: r.results, total: r.total, capped: r.capped, error: r.error, loading: false, ran: true });
        // A search that actually ran and came back, not every keystroke --
        // the debounce above already keeps this to settled lookups.
        if (id === requestId.current && !r.error && query.trim()) void recordRecentSearch(query.trim()).then(setRecent);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filter, runnable, visible, ownedOnly, userId, query]);

  function pickRecent(term: string) {
    setQuery(term);
    input.current?.focus();
  }

  function toggleColor(c: Color) {
    setFacets(f => ({ ...f, colors: f.colors.includes(c) ? f.colors.filter(x => x !== c) : [...f.colors, c] }));
  }
  function setCmc(op: NumericOp, raw: string) {
    setCmcText(raw);
    const n = Number.parseInt(raw, 10);
    setFacets(f => ({ ...f, cmc: Number.isFinite(n) ? { op, value: n } : null }));
  }
  function clearFilters() { setFacets(EMPTY_FACETS); setCmcText(''); }

  if (!mounted) return null;
  const facetCount = advancedFacetCount({ ...EMPTY_ADVANCED_FILTER, ...facets });
  const tile = (screenWidth - space.xl * 2 - space.sm * (COLUMNS - 1)) / COLUMNS;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.scrim, { opacity: progress }]} />
      <Animated.View
        style={[
          styles.panel,
          { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom },
          { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-screenHeight, 0] }) }] },
        ]}
      >
        <View style={styles.row}>
          <View style={styles.field}>
            <Ionicons name="search" size={20} color={text.secondary} />
            <TextInput
              ref={input}
              accessibilityLabel="Search cards"
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search cards"
              placeholderTextColor={text.secondary}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {!!query && (
              <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={text.secondary} />
              </Pressable>
            )}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.toggleRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(v => !v)} style={styles.filtersToggle} disabled={!!parsed}>
            <Ionicons name="options-outline" size={18} color={text.primary} />
            <Text style={styles.filtersLabel}>{parsed ? 'Using your typed syntax' : facetCount ? `Filters (${facetCount})` : 'Filters'}</Text>
            {!parsed && <Ionicons name={showFilters ? 'chevron-up' : 'chevron-down'} size={16} color={text.secondary} />}
          </Pressable>
          {!!userId && (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ownedOnly }} accessibilityLabel="Owned only" onPress={() => setOwnedOnly(v => !v)} style={[styles.ownedPill, ownedOnly && styles.ownedPillOn]}>
              <Ionicons name={ownedOnly ? 'checkbox' : 'square-outline'} size={16} color={ownedOnly ? text.onAccent : text.secondary} />
              <Text style={[styles.ownedLabel, ownedOnly && styles.ownedLabelOn]}>Owned only</Text>
            </Pressable>
          )}
        </View>

        {showFilters && !parsed && (
          <ScrollView style={[styles.filters, { maxHeight: Math.min(FILTERS_MAX_HEIGHT, screenHeight * 0.4) }]} contentContainerStyle={styles.filtersBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.groupLabel}>Colors</Text>
            <View style={styles.colorRow}>
              {COLORS.map(c => {
                const on = facets.colors.includes(c);
                return (
                  <Pressable key={c} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={COLOR_NAMES[c]} onPress={() => toggleColor(c)} style={[styles.colorChip, on && styles.colorChipOn]}>
                    <ManaSymbol code={c} size={28} hidden />
                  </Pressable>
                );
              })}
            </View>
            {facets.colors.length > 0 && (
              <Choices values={['all', 'any', 'exactly', 'atMost']} selected={facets.colorMode} labels={COLOR_MODE_LABELS} onSelect={v => setFacets(f => ({ ...f, colorMode: v as ColorMode }))} />
            )}

            <Text style={styles.groupLabel}>Mana value</Text>
            <View style={styles.inline}>
              <Choices values={CMC_OPS} selected={facets.cmc?.op ?? 'eq'} labels={CMC_LABELS} onSelect={v => setCmc(v as NumericOp, cmcText)} />
              <TextInput accessibilityLabel="Mana value" style={[styles.smallInput]} value={cmcText} onChangeText={t => setCmc(facets.cmc?.op ?? 'eq', t.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="Any" placeholderTextColor={text.secondary} maxLength={2} />
            </View>

            <Text style={styles.groupLabel}>Type</Text>
            <TextInput accessibilityLabel="Type" style={styles.textInput} value={facets.type} onChangeText={t => setFacets(f => ({ ...f, type: t }))} placeholder="e.g. legendary creature" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} />

            <Text style={styles.groupLabel}>Rules text</Text>
            <TextInput accessibilityLabel="Rules text" style={styles.textInput} value={facets.oracle} onChangeText={t => setFacets(f => ({ ...f, oracle: t }))} placeholder="e.g. draw a card" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} />

            <Text style={styles.groupLabel}>Set code</Text>
            <TextInput accessibilityLabel="Set code" style={styles.textInput} value={facets.set} onChangeText={t => setFacets(f => ({ ...f, set: t }))} placeholder="e.g. fdn" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} maxLength={8} />

            <Text style={styles.groupLabel}>Rarity</Text>
            <Choices values={RARITIES} selected={facets.rarity} labels={RARITY_LABELS} onSelect={v => setFacets(f => ({ ...f, rarity: v }))} />

            {facetCount > 0 && <Button secondary label="Clear filters" onPress={clearFilters} />}
          </ScrollView>
        )}

        {!!parsed?.unsupported.length && <Text style={styles.note}>Not understood, so ignored: {parsed.unsupported.join(' ')}</Text>}

        <View style={styles.results}>
          {!runnable ? (
            recent.length > 0 ? (
              <View>
                <Text style={styles.groupLabel}>Recent searches</Text>
                {recent.map(term => (
                  <Pressable key={term} accessibilityRole="button" onPress={() => pickRecent(term)} style={styles.recentRow}>
                    <Ionicons name="time-outline" size={16} color={text.secondary} />
                    <Text style={styles.recentText}>{term}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.hint}>Type a card name, or open Filters to search by color, mana value, type, rules text, set or rarity. Scryfall syntax works too, like {'“c:r cmc<=2”'}.</Text>
            )
          ) : state.error ? (
            <Text style={styles.error}>The search couldn’t complete: {state.error}</Text>
          ) : state.loading && state.results.length === 0 ? (
            <ActivityIndicator color={text.secondary} style={styles.spinner} />
          ) : state.ran && state.results.length === 0 ? (
            <Text style={styles.hint}>Nothing matches that.</Text>
          ) : (
            <FlatList
              data={state.results}
              keyExtractor={r => r.name}
              numColumns={COLUMNS}
              columnWrapperStyle={styles.gridRow}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListHeaderComponent={state.total > 0 ? (
                <Text style={styles.count}>{state.capped ? 'Too many matches to show them all. Add a filter or a bit more of the name to narrow it down.' : state.total > state.results.length ? `Showing ${state.results.length} of ${state.total} cards. Narrow the search to see the rest.` : `${state.total} card${state.total === 1 ? '' : 's'}`}</Text>
              ) : null}
              renderItem={({ item }) => <SearchTile item={item} tile={tile} onOpen={() => { Keyboard.dismiss(); setZoomed(item); }} />}
              contentContainerStyle={styles.gridContent}
            />
          )}
        </View>
      </Animated.View>

      <CardDetails name={zoomed?.name ?? null} onClose={() => setZoomed(null)} />
    </View>
  );
}

/** One result tile. A two-sided card gets a flip badge that swaps the picture and the name; the state is the tile's own, so it is gone with the tile. */
function SearchTile({ item, tile, onOpen }: { item: CardSearchResult; tile: number; onOpen(): void }) {
  const styles = useStyles();
  const face = useCardFace({ name: item.name, layout: item.layout, image: item.image, imageSmall: item.imageSmall }, 'small');
  const name = face.name ?? item.name;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onOpen} style={{ width: tile }}>
      {face.image
        ? <Image source={{ uri: face.image }} onError={face.onImageError} style={[styles.thumb, { width: tile, height: tile / CARD_ASPECT }]} />
        : <View style={[styles.thumb, styles.thumbEmpty, { width: tile, height: tile / CARD_ASPECT }]}><Text style={styles.thumbName}>{name}</Text></View>}
      <Text numberOfLines={2} style={styles.cardName}>{name}</Text>
      {item.printingCount > 1 && <Text style={styles.printings}>{item.printingCount} printings</Text>}
      {face.canFlip && <FlipBadge onPress={face.flip} otherName={face.otherName} />}
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 20, elevation: 20 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim },
  panel: { ...StyleSheet.absoluteFillObject, backgroundColor: surface.canvas, paddingHorizontal: space.xl, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  input: { flex: 1, ...type.body, color: text.primary, paddingVertical: 0 },
  cancel: { minHeight: 44, justifyContent: 'center' },
  cancelText: { ...type.body, color: text.primary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filtersToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32 },
  filtersLabel: { ...type.bodySm, color: text.primary, fontFamily: type.label.fontFamily },
  ownedPill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 32, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline },
  ownedPillOn: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  ownedLabel: { ...type.bodySm, color: text.secondary },
  ownedLabelOn: { color: text.onAccent },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  recentText: { ...type.body, color: text.primary },
  filters: { borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  filtersBody: { padding: space.lg, gap: space.sm },
  groupLabel: { ...type.label, color: text.secondary, marginTop: space.sm },
  colorRow: { flexDirection: 'row', gap: space.sm },
  colorChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: border.strong },
  // A symbol keeps its own colours, so "on" is a ring and a soft wash rather than a solid accent fill.
  colorChipOn: { backgroundColor: accent.soft, borderColor: accent.DEFAULT, borderWidth: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  smallInput: { width: 64, height: 40, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...type.body },
  textInput: { height: 40, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...type.body },
  note: { ...type.bodySm, color: text.secondary },
  results: { flex: 1 },
  hint: { ...type.bodySm, color: text.secondary },
  error: { ...type.bodySm, color: text.primary },
  spinner: { marginTop: space.xxxl },
  count: { ...type.bodySm, color: text.secondary, marginBottom: space.sm },
  gridContent: { paddingBottom: space.xxxl },
  gridRow: { gap: space.sm, marginBottom: space.md },
  thumb: { borderRadius: radius.sm, backgroundColor: surface.sunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', padding: space.sm },
  thumbName: { ...type.label, color: text.secondary, textAlign: 'center' },
  cardName: { ...type.label, color: text.primary, marginTop: 4 },
  printings: { ...type.label, color: text.secondary },
}));
