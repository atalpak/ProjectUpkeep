import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LANGUAGE_LABELS, type LanguageCode } from '@upkeep/domain';
import { CardDetails } from '../components/CardDetails';
import { Button, Notice } from '../components/ui';
import { FlipThumb } from '../components/FlipThumb';
import { errorMessage } from '../errors';
import { fetchFriendTradables, fetchFriendWants, removeFriendship, type FriendCard } from '../friends';
import type { FriendsStackParamList, TabParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';

/** One friend: what they have open for trade, and what they want. Tapping a card opens its details. */
export function FriendProfileScreen({ route, navigation }: NativeStackScreenProps<FriendsStackParamList, 'FriendProfile'>) {
  const styles = useStyles();
  const { friendId, username, friendshipId } = route.params;
  // Trades is a sibling tab, so the builder is reached through the tab navigator.
  const tabs = useNavigation<NavigationProp<TabParamList>>();
  const [tradables, setTradables] = useState<FriendCard[]>([]);
  const [wants, setWants] = useState<FriendCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<FriendCard | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    void Promise.all([fetchFriendTradables(friendId), fetchFriendWants(friendId)]).then(
      ([t, w]) => { if (alive.current) { setTradables(t); setWants(w); setLoading(false); } },
      e => { if (alive.current) { setError(errorMessage(e)); setLoading(false); } },
    );
  }, [friendId]);

  function unfriend() {
    Alert.alert(`Remove ${username}?`, 'You will no longer see each other’s trade binders or wish lists.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove friend', style: 'destructive', onPress: () => { void removeFriendship(friendshipId).then(() => navigation.goBack(), e => setError(errorMessage(e))); } },
    ]);
  }

  const list = (cards: FriendCard[], empty: string) => cards.length === 0
    ? <Text style={styles.sub}>{empty}</Text>
    : cards.map(c => (
      <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, details`} onPress={() => setDetails(c)} style={styles.row}>
        <FlipThumb card={{ name: c.name, layout: c.layout, imageSmall: c.imageSmall }} thumbStyle={styles.thumb}>
          {name => (
            <View style={styles.grow}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.sub}>{c.setCode.toUpperCase()} · #{c.collectorNumber} · ×{c.quantity}{c.finish ? ` · ${c.finish}` : ''}{c.language && c.language !== 'en' ? ` · ${LANGUAGE_LABELS[c.language as LanguageCode] ?? c.language}` : ''}</Text>
            </View>
          )}
        </FlipThumb>
      </Pressable>
    ));

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {!!error && <Notice>{error}</Notice>}
      {loading ? <Text style={styles.sub}>Loading…</Text> : (
        <>
          <Text style={styles.heading}>Open for trade</Text>
          {list(tradables, `${username} hasn’t opened anything for trade.`)}
          <Text style={styles.heading}>Wants</Text>
          {list(wants, `${username}’s wish list is empty.`)}
        </>
      )}
      <Button label="Propose a trade" onPress={() => tabs.navigate('Trades', { screen: 'TradeBuilder', params: { friendId, username } })} />
      <Button secondary label="Remove friend" onPress={unfriend} />
      <CardDetails name={details?.name ?? null} printingId={details?.cardId} ownedFinish={details?.finish} onClose={() => setDetails(null)} />
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  heading: { ...type.title, color: text.primary, marginTop: space.md },
  sub: { ...type.bodySm, color: text.secondary },
  grow: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  thumb: { width: 56, height: 78, borderRadius: radius.sm, backgroundColor: surface.sunken },
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
}));
