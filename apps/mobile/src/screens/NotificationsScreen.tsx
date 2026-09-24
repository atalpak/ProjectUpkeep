import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation, type NavigationProp } from '@react-navigation/native';
import { notificationSentence, relativeTime } from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { GroupRow, ListGroup, Notice } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { errorMessage } from '../errors';
import { PAGES, type TabParamList } from '../navigation';
import { fetchNotifications, markAllRead, type AppNotification } from '../notifications';
import { makeStyles } from '../preferences';
import { accent, radius, space, text, type } from '../theme';

/**
 * The alerts inbox. Opening it is the acknowledgement (as on the web): the list
 * is fetched with its unread state, THEN marked read, so the dots you came here
 * for stay visible for this visit and are gone the next.
 */
export function NotificationsScreen() {
  const styles = useStyles();
  const { userId } = useApp();
  const focused = useIsFocused();
  const nav = useNavigation<NavigationProp<TabParamList>>();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await fetchNotifications(userId);
      if (!alive.current) return;
      setItems(list); setError('');
      if (list.some(n => !n.read)) await markAllRead(userId);
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { if (focused) void load(); }, [focused, load]);

  function open(n: AppNotification) {
    if (n.tradeId) nav.navigate('Trades', { screen: 'TradeDetail', params: { tradeId: n.tradeId } });
    else if (n.friendshipId) nav.navigate('Friends');
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PageTitle>{PAGES.Notifications.title}</PageTitle>
      {!!error && <Notice>{error}</Notice>}
      {loading && <Text style={styles.sub}>Loading…</Text>}
      {!loading && items.length === 0 && !error && <Text style={styles.sub}>Nothing yet. Trade offers and friend requests show up here.</Text>}
      <ListGroup>
      {items.map(n => (
        <GroupRow key={n.id} accessibilityLabel={`${notificationSentence(n.type, n.actor)} ${relativeTime(n.createdAt)}${n.read ? '' : ', unread'}`} onPress={() => open(n)}>
          <View style={[styles.dot, !n.read && styles.dotUnread]} />
          <View style={styles.grow}>
            <Text style={styles.name}>{notificationSentence(n.type, n.actor)}</Text>
            <Text style={styles.sub}>{relativeTime(n.createdAt)}</Text>
          </View>
        </GroupRow>
      ))}
      </ListGroup>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  sub: { ...type.bodySm, color: text.secondary },
  grow: { flex: 1, gap: 2 },
  name: { ...type.body, color: text.primary },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: 'transparent' },
  dotUnread: { backgroundColor: accent.DEFAULT },
}));
