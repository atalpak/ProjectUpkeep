import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { CollectionAuthError } from '../collection';
import { COLOUR_LABELS, fetchDashboard, type ColourBucket, type DashboardData } from '../dashboard';
import { CardDetails } from '../components/CardDetails';
import { MANA_COLORS } from '../components/ManaCost';
import { Button, Notice } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { errorMessage } from '../errors';
import { PAGES, type TabParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { MortStage } from '../mort/MortStage';
import { accent, border, fontFamily, radius, space, surface, text, type as typeTokens } from '../theme';

const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const DECK_ROWS = 4;
const WISH_ROWS = 3;

/**
 * Where your collection stands, and what needs a decision: the same three
 * blocks as the web dashboard (things needing attention, deck status,
 * collection status) plus what you added last. Read-only; every row jumps to
 * the page where the thing can be dealt with. See src/dashboard.ts.
 */
export function DashboardScreen() {
  const styles = useStyles();
  const { userId } = useApp();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const focused = useIsFocused();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [details, setDetails] = useState<{ name: string; cardId: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const loaded = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(''); setAuthError(false);
    try {
      const result = await fetchDashboard(userId);
      if (alive.current) { setData(result); loaded.current = Date.now(); }
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
  }, [userId]);

  // On first view, and again on coming back if the numbers are a little old
  // (scanning or sleeving elsewhere changes them).
  useEffect(() => {
    if (focused && (loaded.current === 0 || Date.now() - loaded.current > 20_000)) void load();
  }, [focused, load]);

  const decksWithList = (data?.decks ?? []).filter(d => d.cardCount > 0);
  const rankedDecks = [...decksWithList].sort((a, b) => (b.cardCount - b.sleevedCount) - (a.cardCount - a.sleevedCount) || a.name.localeCompare(b.name));
  const shownDecks = rankedDecks.slice(0, DECK_ROWS);
  const moreDecks = rankedDecks.length - shownDecks.length;
  const wish = data?.wishMatches ?? [];
  const attention: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress(): void }[] = [];
  if (data) {
    if (data.tradesAwaiting > 0) attention.push({ key: 'trades', icon: 'swap-horizontal-outline', label: `${data.tradesAwaiting} trade${data.tradesAwaiting === 1 ? '' : 's'} waiting on you`, onPress: () => navigation.navigate('Trades') });
    if (data.tradesExpiringSoon > 0) attention.push({ key: 'trades-expiring', icon: 'time-outline', label: `${data.tradesExpiringSoon} offer${data.tradesExpiringSoon === 1 ? '' : 's'} expiring soon`, onPress: () => navigation.navigate('Trades') });
    if (data.unsortedCards > 0) attention.push({ key: 'unsorted', icon: 'file-tray-outline', label: `${data.unsortedCards} card${data.unsortedCards === 1 ? ' is' : 's are'} not filed anywhere yet`, onPress: () => navigation.navigate('Locations') });
    for (const w of wish.slice(0, WISH_ROWS)) {
      attention.push({ key: `w-${w.cardId}`, icon: 'heart-outline', label: `${w.name}: ${w.friends} friend${w.friends === 1 ? ' has' : 's have'} it for trade`, onPress: () => navigation.navigate('Wishlist') });
    }
    if (wish.length > WISH_ROWS) attention.push({ key: 'more-wish', icon: 'heart-outline', label: `${wish.length - WISH_ROWS} more wish list ${wish.length - WISH_ROWS === 1 ? 'match' : 'matches'}`, onPress: () => navigation.navigate('Wishlist') });
  }

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={text.secondary} />}
    >
      <PageTitle>{PAGES.Dashboard.title}</PageTitle>
      {loading && !data && <Text style={styles.sub}>Loading your dashboard…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again.</Notice>}
      {!!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}

      {data && data.totalEntries === 0 && (
        <View style={styles.empty}>
          <MortStage size="M" />
          <Text style={styles.emptyTitle}>Nothing tracked yet</Text>
          <Text style={styles.sub}>Once you add your first card, its totals and whereabouts show up here.</Text>
          <Button label="Scan a card" onPress={() => navigation.navigate('Scan')} />
        </View>
      )}

      {data && data.totalEntries > 0 && (
        <>
          <View style={styles.tiles}>
            <Tile label="Collection value" value={money(data.valueTotal)} hint="Scryfall estimate" onPress={() => navigation.navigate('Collection')} />
            <Tile label="Total cards" value={data.totalCards.toLocaleString()} onPress={() => navigation.navigate('Collection')} />
            <Tile label="Unsorted" value={data.unsortedCards.toLocaleString()} onPress={() => navigation.navigate('Locations')} />
            <Tile label="Decks" value={data.decks.length.toLocaleString()} onPress={() => navigation.navigate('Decks')} />
          </View>

          <Section title="Needs attention">
            {attention.length === 0
              ? <Text style={styles.sub}>Nothing needs your attention right now.</Text>
              : attention.map(a => (
                <Pressable key={a.key} accessibilityRole="button" onPress={a.onPress} style={styles.row}>
                  <Ionicons name={a.icon} size={18} color={text.secondary} />
                  <Text style={styles.rowText}>{a.label}</Text>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              ))}
          </Section>

          {shownDecks.length > 0 && (
            <Section title="Deck status">
              <View style={styles.card}>
                {shownDecks.map((d, i) => {
                  const outstanding = Math.max(0, d.cardCount - d.sleevedCount);
                  return (
                    <Pressable key={d.id} accessibilityRole="button" onPress={() => navigation.navigate('Decks')} style={[styles.deckRow, i > 0 && styles.deckRowDivider]}>
                      <Text numberOfLines={1} style={styles.deckName}>{d.name}</Text>
                      {outstanding === 0
                        ? <Text style={styles.ready}>Ready</Text>
                        : <Text style={styles.sub}>{outstanding} to sleeve</Text>}
                    </Pressable>
                  );
                })}
                {moreDecks > 0 && (
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Decks')} style={[styles.deckRow, styles.deckRowDivider]}>
                    <Text style={styles.sub}>{moreDecks} more {moreDecks === 1 ? 'deck' : 'decks'}</Text>
                  </Pressable>
                )}
              </View>
            </Section>
          )}

          {data.recent.length > 0 && (
            <Section title="Recently added" action={{ label: 'View all', onPress: () => navigation.navigate('Collection') }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
                {data.recent.map(r => (
                  <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.name} onPress={() => setDetails({ name: r.name, cardId: r.cardId })}>
                    {r.imageSmall ? <Image source={{ uri: r.imageSmall }} style={styles.recentImage} /> : <View style={[styles.recentImage, styles.recentEmpty]}><Text style={styles.recentName}>{r.name}</Text></View>}
                  </Pressable>
                ))}
              </ScrollView>
            </Section>
          )}

          <Section title="Collection status">
            {data.mostValuable && (
              <Pressable accessibilityRole="button" onPress={() => setDetails({ name: data.mostValuable!.name, cardId: data.mostValuable!.cardId })}>
                <Text style={styles.sub}>Most valuable: <Text style={styles.strong}>{data.mostValuable.name}</Text> ({money(data.mostValuable.value)}){data.unpricedEntries > 0 ? ` · ${data.unpricedEntries} ${data.unpricedEntries === 1 ? 'entry' : 'entries'} unpriced` : ''}</Text>
              </Pressable>
            )}
            <View style={styles.colours}>
              {data.colours.map(c => (
                <View key={c.bucket} style={styles.colour} accessibilityLabel={`${COLOUR_LABELS[c.bucket]}: ${c.count}`}>
                  <ColourDot bucket={c.bucket} />
                  <Text style={styles.colourCount}>{c.count.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          </Section>
        </>
      )}
      <CardDetails name={details?.name ?? null} printingId={details?.cardId} onClose={() => setDetails(null)} />
    </ScrollView>
  );
}

function ColourDot({ bucket }: { bucket: ColourBucket }) {
  const styles = useStyles();
  const solid = MANA_COLORS[bucket === 'M' || bucket === 'C' ? 'C' : bucket]!;
  if (bucket === 'M') return <View style={[styles.dot, { backgroundColor: '#C9A227' }]} />;
  if (bucket === 'C') return <View style={[styles.dot, { borderWidth: 1, borderColor: text.secondary }]} />;
  return <View style={[styles.dot, { backgroundColor: solid.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.4)' }]} />;
}

function Tile({ label, value, hint, onPress }: { label: string; value: string; hint?: string; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {!!hint && <Text style={styles.tileHint}>{hint}</Text>}
    </Pressable>
  );
}

function Section({ title, action, children }: { title: string; action?: { label: string; onPress(): void }; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.heading}>{title}</Text>
        {action && <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8}><Text style={styles.link}>{action.label}</Text></Pressable>}
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.xl },
  sub: { ...typeTokens.bodySm, color: text.secondary },
  strong: { fontFamily: fontFamily.bodySemiBold, color: text.primary },
  empty: { alignItems: 'center', gap: space.md, paddingTop: space.xxl },
  emptyTitle: { ...typeTokens.title, color: text.primary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { width: '47.5%', flexGrow: 1, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, gap: 2 },
  tileLabel: { ...typeTokens.label, color: text.secondary },
  tileValue: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 32, color: text.primary },
  tileHint: { ...typeTokens.label, fontFamily: fontFamily.body, color: text.secondary },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  heading: { ...typeTokens.title, fontSize: 16, lineHeight: 22, color: text.primary },
  link: { ...typeTokens.bodySm, color: text.primary, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  rowText: { flex: 1, ...typeTokens.body, color: text.primary },
  chevron: { fontSize: 22, color: text.secondary },
  card: { borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, overflow: 'hidden' },
  deckRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12 },
  deckRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border.hairline },
  deckName: { flex: 1, ...typeTokens.body, fontFamily: typeTokens.title.fontFamily, color: text.primary },
  ready: { ...typeTokens.label, color: text.onAccent, backgroundColor: accent.DEFAULT, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  recentRow: { gap: space.sm },
  recentImage: { width: 70, height: 98, borderRadius: 6, backgroundColor: surface.sunken },
  recentEmpty: { alignItems: 'center', justifyContent: 'center', padding: 4 },
  recentName: { ...typeTokens.label, color: text.secondary, textAlign: 'center' },
  colours: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  colour: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  colourCount: { ...typeTokens.bodySm, color: text.secondary },
}));
