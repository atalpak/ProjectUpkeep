import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { fetchFriendSupplyCounts, fetchWantList, removeWant, type WantEntry } from '../cardDetails';
import { CardDetails } from '../components/CardDetails';
import { Button, Notice } from '../components/ui';
import { errorMessage } from '../errors';
import { makeStyles } from '../preferences';
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
  const [wants, setWants] = useState<WantEntry[]>([]);
  const [supply, setSupply] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<WantEntry | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await fetchWantList(userId);
      if (!alive.current) return;
      setWants(list);
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

  const total = wants.reduce((sum, w) => sum + w.quantity, 0);
  return (
    <>
      <FlatList
        data={wants}
        keyExtractor={w => w.id}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <>
            {!!error && (<><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>)}
            {!loading && !error && wants.length > 0 && <Text style={styles.heading}>{total} card{total === 1 ? '' : 's'} across {wants.length} entr{wants.length === 1 ? 'y' : 'ies'}</Text>}
            {loading && <Text style={styles.body}>Loading your wish list…</Text>}
            {!loading && !error && wants.length === 0 && <Text style={styles.body}>Your wish list is empty. Find a card in Search and tap “Add to wish list”.</Text>}
          </>
        }
        renderItem={({ item }) => {
          const friends = supply.get(item.oracleId) ?? 0;
          return (
            <View style={styles.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, details`} onPress={() => setDetails(item)} style={styles.main}>
                {item.imageSmall ? <Image source={{ uri: item.imageSmall }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
                <View style={styles.grow}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.body}>{item.setCode.toUpperCase()} · #{item.collectorNumber} · Want {item.quantity}</Text>
                  {friends > 0 && <Text style={styles.friends}>{friends} friend{friends === 1 ? ' has' : 's have'} it for trade</Text>}
                </View>
              </Pressable>
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
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  heading: { ...type.title, color: text.primary },
  body: { ...type.bodySm, color: text.secondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  thumb: { width: 56, height: 78, borderRadius: radius.sm, backgroundColor: surface.sunken },
  thumbEmpty: {},
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  friends: { ...type.bodySm, color: text.primary },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
}));
