import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_WANT_QUANTITY, MIN_WANT_QUANTITY } from '@upkeep/domain';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { fetchFriendSupplyCounts, fetchWantList, removeWant, type WantEntry } from '../cardDetails';
import { setWantQuantity } from '../wishlist';
import { CardDetails } from '../components/CardDetails';
import { Button, EmptyState, Notice } from '../components/ui';
import { FlipThumb } from '../components/FlipThumb';
import { PageTitle } from '../components/PageTitle';
import { errorMessage } from '../errors';
import { PAGES } from '../navigation';
import { makeStyles } from '../preferences';
import { useSearchOverlay } from '../searchOverlay';
import { border, radius, space, surface, text, type } from '../theme';

/**
 * The signed-in user's wish list: every card they want, with how many friends
 * have a copy open for trade. Reloads whenever the tab comes into view, since
 * the card sheet can add to it from Search and from other screens.
 */
export function WishlistScreen() {
  const { userId } = useApp();
  if (!userId) return null;
  return <WishlistList userId={userId} />;
}

function WishlistList({ userId }: { userId: string }) {
  const styles = useStyles();
  const focused = useIsFocused();
  const openSearch = useSearchOverlay().open;
  const [wants, setWants] = useState<WantEntry[]>([]);
  const [supply, setSupply] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<WantEntry | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Quantities the person has asked for that the server may not have yet: queued, and the one being written.
  const wantedNext = useRef(new Map<string, number>());
  const inFlight = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await fetchWantList(userId);
      if (!alive.current) return;
      // A tap not yet written (or being written) must survive this reload, or it would visibly undo itself.
      setWants(list.map(w => {
        const pending = wantedNext.current.get(w.id) ?? inFlight.current.get(w.id);
        return pending === undefined ? w : { ...w, quantity: pending };
      }));
      setLoading(false);
      // Friends' supply is a nice-to-have: a failure just hides the counts.
      const counts = await fetchFriendSupplyCounts(userId, [...new Set(list.map(w => w.oracleId))]).catch(() => new Map<string, number>());
      if (alive.current) setSupply(counts);
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (focused) void load(); }, [focused, load]);

  function confirmRemove(w: WantEntry) {
    Alert.alert(`Remove ${w.name}?`, 'It comes off your wish list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => { void removeWant(userId, w.id).then(() => setWants(prev => prev.filter(x => x.id !== w.id)), e => setError(errorMessage(e))); },
      },
    ]);
  }

  // Optimistic: the number moves at once, so a burst of taps feels instant. The
  // writes are serialised per row: only one is in flight, and taps made meanwhile
  // just update the value wanted next, so the last tap is what lands last and
  // responses can never arrive out of order. On failure the row is re-read from
  // the server rather than restored from a value captured by an old render.
  const writing = useRef(new Set<string>());

  async function flushQuantity(id: string) {
    if (writing.current.has(id)) return;
    writing.current.add(id);
    try {
      for (;;) {
        const value = wantedNext.current.get(id);
        if (value === undefined) break;
        wantedNext.current.delete(id);
        inFlight.current.set(id, value);
        await setWantQuantity(userId, id, value);
        inFlight.current.delete(id);
      }
    } catch (e) {
      // Drop what failed, but keep `writing` set until the reload lands so a tap
      // made meanwhile queues instead of racing it; load() re-applies that tap.
      inFlight.current.delete(id);
      wantedNext.current.delete(id);
      try { await load(); } finally { writing.current.delete(id); }
      if (alive.current) setError(errorMessage(e));
      if (wantedNext.current.has(id)) void flushQuantity(id);
      return;
    }
    writing.current.delete(id);
  }

  function changeQuantity(w: WantEntry, delta: number) {
    const next = Math.min(MAX_WANT_QUANTITY, Math.max(MIN_WANT_QUANTITY, w.quantity + delta));
    if (next === w.quantity) return;
    setWants(prev => prev.map(x => x.id === w.id ? { ...x, quantity: next } : x));
    wantedNext.current.set(w.id, next);
    void flushQuantity(w.id);
  }

  const total = wants.reduce((sum, w) => sum + w.quantity, 0);
  return (
    <>
      <FlatList
        data={wants}
        keyExtractor={w => w.id}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <>
            <PageTitle>{PAGES.Wishlist.title}</PageTitle>
            {!!error && (<><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>)}
            {!loading && !error && wants.length > 0 && <Text style={styles.heading}>{total} card{total === 1 ? '' : 's'} across {wants.length} entr{wants.length === 1 ? 'y' : 'ies'}</Text>}
            {loading && <Text style={styles.body}>Loading your wish list…</Text>}
            {!loading && !error && wants.length === 0 && (
              <EmptyState title="Your wish list is empty" body="Find a card you're after and tap “Add to wish list”. Upkeep will tell you which friends have it.">
                <Button label="Search for a card" onPress={openSearch} />
              </EmptyState>
            )}
          </>
        }
        renderItem={({ item }) => {
          const friends = supply.get(item.oracleId) ?? 0;
          return (
            <View style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, details`} onPress={() => setDetails(item)} style={styles.main}>
                <FlipThumb card={{ name: item.name, layout: item.layout, imageSmall: item.imageSmall }} thumbStyle={[styles.thumb, !item.imageSmall && styles.thumbEmpty]}>
                  {name => (
                    <View style={styles.grow}>
                      <Text style={styles.name}>{name}</Text>
                      <Text style={styles.body}>{item.setCode.toUpperCase()} · #{item.collectorNumber}</Text>
                      {friends > 0 && <Text style={styles.friends}>{friends} friend{friends === 1 ? ' has' : 's have'} it for trade</Text>}
                    </View>
                  )}
                </FlipThumb>
              </Pressable>
              <View style={styles.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Want fewer ${item.name}`} accessibilityState={{ disabled: item.quantity <= MIN_WANT_QUANTITY }} disabled={item.quantity <= MIN_WANT_QUANTITY} onPress={() => changeQuantity(item, -1)} hitSlop={6} style={styles.stepButton}>
                  <Ionicons name="remove" size={18} color={item.quantity <= MIN_WANT_QUANTITY ? text.secondary : text.primary} />
                </Pressable>
                <Text accessibilityLabel={`Want ${item.quantity}`} style={styles.stepValue}>{item.quantity}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Want more ${item.name}`} onPress={() => changeQuantity(item, 1)} hitSlop={6} style={styles.stepButton}>
                  <Ionicons name="add" size={18} color={text.primary} />
                </Pressable>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => confirmRemove(item)} hitSlop={8} style={styles.remove}>
                <Ionicons name="trash-outline" size={20} color={text.secondary} />
              </Pressable>
            </View>
          );
        }}
      />
      <CardDetails name={details?.name ?? null} printingId={details?.cardId} onClose={() => { setDetails(null); void load(); }} />
    </>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  heading: { ...type.title, color: text.primary },
  body: { ...type.bodySm, color: text.secondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  thumb: { width: 56, height: 78, borderRadius: radius.sm, backgroundColor: surface.sunken },
  thumbEmpty: {},
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  friends: { ...type.bodySm, color: text.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline },
  stepButton: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...type.title, fontSize: 15, minWidth: 24, textAlign: 'center', color: text.primary },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
}));
