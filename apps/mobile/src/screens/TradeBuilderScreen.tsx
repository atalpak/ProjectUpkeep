import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { mirrorTradeForCounter } from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { TradingTerms } from '../components/TradingTerms';
import { Button, Choices, Notice } from '../components/ui';
import { errorMessage } from '../errors';
import { fetchFriendTradables, type FriendCard } from '../friends';
import type { TradesStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';
import { fetchMyTradables, fetchTrade, counterSource, proposeTrade, type Selection } from '../trades';
import { CURRENT_TOS_VERSION, fetchTosStatus, tradingAllowed, type TosStatus } from '../tos';

type Side = 'want' | 'offer';
const total = (s: Selection) => Object.values(s).reduce((a, b) => a + b, 0);

/**
 * Building an offer: what you want from their trade binder, and what you put
 * up from yours. Both sides are picked here by the proposer -- the recipient's
 * job is a yes or no to something concrete. Nothing is written until Send, so
 * a half-built trade never reaches the database.
 *
 * With `counterOf` it opens pre-filled from the offer you received, mirrored
 * into your frame by @upkeep/domain's mirrorTradeForCounter.
 */
export function TradeBuilderScreen({ route, navigation }: NativeStackScreenProps<TradesStackParamList, 'TradeBuilder'>) {
  const styles = useStyles();
  const { userId } = useApp();
  const { friendId, username, counterOf } = route.params;
  const [side, setSide] = useState<Side>('want');
  const [theirs, setTheirs] = useState<FriendCard[]>([]);
  const [mine, setMine] = useState<FriendCard[]>([]);
  const [requesting, setRequesting] = useState<Selection>({});
  const [offering, setOffering] = useState<Selection>({});
  const [filter, setFilter] = useState('');
  const [tos, setTos] = useState<TosStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      try {
        const [t, m, s] = await Promise.all([fetchFriendTradables(friendId), fetchMyTradables(userId), fetchTosStatus(userId)]);
        let seed: { offering: Selection; requesting: Selection } | null = null;
        if (counterOf) {
          const original = await fetchTrade(userId, counterOf);
          if (original) seed = mirrorTradeForCounter(counterSource(original), m.map(c => c.id), t.map(c => c.id));
        }
        if (!alive.current) return;
        setTheirs(t); setMine(m); setTos(s);
        if (seed) { setOffering(seed.offering); setRequesting(seed.requesting); }
      } catch (e) { if (alive.current) setError(errorMessage(e)); }
      finally { if (alive.current) setLoading(false); }
    })();
  }, [userId, friendId, counterOf]);

  const rows = side === 'want' ? theirs : mine;
  const selection = side === 'want' ? requesting : offering;
  const setSelection = side === 'want' ? setRequesting : setOffering;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? rows.filter(r => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, filter]);

  function setQuantity(id: string, quantity: number) {
    const next = { ...selection };
    if (quantity <= 0) delete next[id]; else next[id] = quantity;
    setSelection(next);
  }

  async function send() {
    if (!userId || sending) return;
    setSending(true); setError('');
    try {
      await proposeTrade(userId, { recipientId: friendId, offering, requesting, counterOf });
      if (alive.current) navigation.navigate('TradeList');
    } catch (e) { if (alive.current) { setError(errorMessage(e)); setSending(false); } }
  }

  if (!tradingAllowed(tos) && !loading) {
    return <ScrollView contentContainerStyle={styles.page}><TradingTerms onAccepted={() => setTos({ acceptedAt: new Date().toISOString(), version: CURRENT_TOS_VERSION })} /></ScrollView>;
  }

  const nothing = total(offering) === 0 && total(requesting) === 0;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!!error && <Notice>{error}</Notice>}
      <Text style={styles.title}>{counterOf ? `Counter ${username}’s offer` : `Trade with ${username}`}</Text>
      <Choices
        values={['want', 'offer']}
        selected={side}
        onSelect={v => { setSide(v as Side); setFilter(''); }}
        labels={{ want: `Want (${total(requesting)})`, offer: `Offer (${total(offering)})` }}
      />
      <TextInput accessibilityLabel="Filter by name" style={styles.input} value={filter} onChangeText={setFilter} placeholder="Filter by name" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} />

      {loading && <Text style={styles.sub}>Loading…</Text>}
      {!loading && rows.length === 0 && (
        <Text style={styles.sub}>{side === 'want' ? `${username} has nothing open for trade.` : 'You have no containers open for trade yet. Turn one on in Locations.'}</Text>
      )}
      {!loading && rows.length > 0 && shown.length === 0 && <Text style={styles.sub}>Nothing matches that.</Text>}
      {shown.map(c => {
        const q = selection[c.id] ?? 0;
        return (
          <View key={c.id} style={[styles.row, q > 0 && styles.rowSelected]}>
            {c.imageSmall ? <Image source={{ uri: c.imageSmall }} style={styles.thumb} /> : <View style={styles.thumb} />}
            <View style={styles.grow}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.sub}>{c.setCode.toUpperCase()} · #{c.collectorNumber}{c.finish && c.finish !== 'nonfoil' ? ` · ${c.finish}` : ''} · {c.quantity} available</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`One fewer ${c.name}`} disabled={q === 0} onPress={() => setQuantity(c.id, q - 1)} style={[styles.step, q === 0 && styles.stepOff]}><Text style={styles.stepText}>−</Text></Pressable>
            <Text style={styles.qty}>{q}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`One more ${c.name}`} disabled={q >= c.quantity} onPress={() => setQuantity(c.id, q + 1)} style={[styles.step, q >= c.quantity && styles.stepOff]}><Text style={styles.stepText}>+</Text></Pressable>
          </View>
        );
      })}

      <Button
        label={sending ? 'Sending…' : `${counterOf ? 'Send counter-offer' : 'Propose trade'} (${total(offering)} for ${total(requesting)})`}
        disabled={sending || nothing || loading}
        onPress={() => void send()}
      />
      <Text style={styles.sub}>{counterOf ? 'This replaces their earlier offer. ' : ''}Nothing moves until {username} accepts. Then both collections update at once.</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  title: { ...type.title, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  input: { ...type.body, color: text.primary, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised },
  grow: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  rowSelected: { borderColor: border.strong },
  thumb: { width: 42, height: 58, borderRadius: radius.sm / 2, backgroundColor: surface.sunken },
  name: { ...type.body, color: text.primary },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: border.strong },
  stepOff: { opacity: 0.35 },
  stepText: { fontSize: 20, color: text.primary },
  qty: { ...type.body, color: text.primary, minWidth: 18, textAlign: 'center' },
}));
