import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { expiryLabel } from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { Notice } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { errorMessage } from '../errors';
import { PAGES, type TradesStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, state, surface, text, type } from '../theme';
import { fetchTrades, TRADE_STATUS_LABELS, type Trade } from '../trades';

const count = (lines: Trade['giving']) => lines.reduce((sum, l) => sum + l.quantity, 0);

/**
 * Your trades in three piles: offers waiting on you, offers you are waiting on,
 * and everything settled. Proposing starts from a friend's profile (their trade
 * binder is what you pick from), so there is no "new trade" button here.
 */
export function TradesScreen({ navigation }: NativeStackScreenProps<TradesStackParamList, 'TradeList'>) {
  const styles = useStyles();
  const { userId } = useApp();
  const focused = useIsFocused();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const t = await fetchTrades(userId);
      if (alive.current) { setTrades(t); setError(''); }
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { if (focused) void load(); }, [focused, load]);

  const awaiting = trades.filter(t => t.open && !t.iProposed);
  const waiting = trades.filter(t => t.open && t.iProposed);
  // 'proposed' but timed out is spent: it belongs with the past, badged Expired.
  const past = trades.filter(t => !t.open);

  const row = (t: Trade) => {
    const time = t.status === 'proposed' ? expiryLabel(t.expiresAt) : null;
    return (
      <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`Trade with ${t.otherName}, details`} onPress={() => navigation.navigate('TradeDetail', { tradeId: t.id })} style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.name}>{t.iProposed ? 'You offered' : 'Offer from'} {t.otherName}</Text>
          <Text style={styles.sub}>
            {new Date(t.createdAt).toLocaleDateString()} · you give {count(t.giving)}, get {count(t.receiving)}
          </Text>
          {!!time && <Text style={[styles.sub, t.expired && styles.expired]}>{time}</Text>}
        </View>
        <Text style={styles.badge}>{t.expired ? 'Expired' : TRADE_STATUS_LABELS[t.status]}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  };

  const section = (title: string, list: Trade[]) => list.length > 0 && (
    <View style={styles.group}>
      <Text style={styles.heading}>{title} ({list.length})</Text>
      {list.map(row)}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PageTitle>{PAGES.Trades.title}</PageTitle>
      {!!error && <Notice>{error}</Notice>}
      {loading && <Text style={styles.sub}>Loading…</Text>}
      {!loading && trades.length === 0 && !error && (
        <Text style={styles.sub}>No trades yet. Open a friend from the Friends page and put an offer together from their trade binder.</Text>
      )}
      {section('Waiting on you', awaiting)}
      {section('Waiting on them', waiting)}
      {section('Past', past)}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.lg },
  group: { gap: space.sm },
  heading: { ...type.title, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  expired: { color: state.error },
  grow: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 56, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  name: { ...type.body, color: text.primary },
  badge: { ...type.label, color: text.secondary },
  chevron: { fontSize: 22, color: text.secondary },
}));
