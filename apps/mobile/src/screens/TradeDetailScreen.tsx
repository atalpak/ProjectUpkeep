import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { expiryLabel } from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { TradeLines } from '../components/TradeLines';
import { TradingTerms } from '../components/TradingTerms';
import { Button, DismissingNotice, Notice } from '../components/ui';
import { errorMessage } from '../errors';
import type { TradesStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { space, state, text, type } from '../theme';
import { fetchTrade, acceptTrade, closeTrade, TRADE_STATUS_LABELS, type Trade } from '../trades';
import { fetchTosStatus, tradingAllowed, type TosStatus } from '../tos';

/**
 * One trade. Accepting is the only irreversible thing in the app's social half
 * -- it moves cards between two collections -- so it says exactly what will
 * happen and asks first. The transfer itself is the accept_trade function; the
 * button is only a way of calling it.
 */
export function TradeDetailScreen({ route, navigation }: NativeStackScreenProps<TradesStackParamList, 'TradeDetail'>) {
  const styles = useStyles();
  const { userId } = useApp();
  const focused = useIsFocused();
  const { tradeId } = route.params;
  const [trade, setTrade] = useState<Trade | null>(null);
  const [tos, setTos] = useState<TosStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [t, s] = await Promise.all([fetchTrade(userId, tradeId), fetchTosStatus(userId)]);
      if (alive.current) { setTrade(t); setTos(s); setError(''); }
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId, tradeId]);
  useEffect(() => { if (focused) void load(); }, [focused, load]);

  async function act(work: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (alive.current) setNotice(done); } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
    await load();
  }

  if (!trade) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {!!error && <Notice>{error}</Notice>}
        {loading ? <Text style={styles.sub}>Loading…</Text> : !error && <Text style={styles.sub}>This trade could not be found.</Text>}
      </ScrollView>
    );
  }

  const t = trade;
  const time = t.status === 'proposed' ? expiryLabel(t.expiresAt) : null;
  const gated = !tradingAllowed(tos);

  function confirmAccept() {
    Alert.alert('Accept this trade?', 'The cards move between your collections straight away, and there is no undo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Accept and swap cards', onPress: () => void act(() => acceptTrade(userId!, t.id), 'Trade completed. The cards are now in your collection, unsorted.') },
    ]);
  }

  function confirmClose() {
    const title = t.iProposed ? 'Cancel this offer?' : 'Decline this offer?';
    Alert.alert(title, t.iProposed ? `${t.otherName} will no longer be able to accept it.` : `${t.otherName} will be told you declined.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: t.iProposed ? 'Cancel offer' : 'Decline', style: 'destructive', onPress: () => void act(() => closeTrade(t.id, t.iProposed), t.iProposed ? 'Offer cancelled.' : 'Offer declined.') },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {!!error && <Notice>{error}</Notice>}
      {!!notice && <DismissingNotice onDone={() => setNotice('')}>{notice}</DismissingNotice>}

      <View style={styles.group}>
        <Text style={styles.title}>{t.iProposed ? 'You offered' : 'Offer from'} {t.otherName}</Text>
        <Text style={styles.sub}>
          {new Date(t.createdAt).toLocaleDateString()} · {t.expired ? 'Expired' : TRADE_STATUS_LABELS[t.status]}
        </Text>
        {!!time && <Text style={[styles.sub, t.expired && styles.expired]}>{time}</Text>}
      </View>

      <TradeLines title="You give" lines={t.giving} />
      <TradeLines title="You get" lines={t.receiving} />

      {t.open && !t.iProposed && gated && <TradingTerms onAccepted={() => void load()} />}
      {t.open && !t.iProposed && !gated && (
        <>
          <Button label={busy ? 'Working…' : 'Accept and swap cards'} disabled={busy} onPress={confirmAccept} />
          {t.otherId && (
            <Button secondary label="Counter with a new offer" disabled={busy} onPress={() => navigation.navigate('TradeBuilder', { friendId: t.otherId!, username: t.otherName, counterOf: t.id })} />
          )}
        </>
      )}
      {t.open && <Button secondary label={t.iProposed ? 'Cancel offer' : 'Decline'} disabled={busy} onPress={confirmClose} />}

      {t.expired && (
        <>
          <Text style={[styles.sub, styles.expired]}>This offer expired and can no longer be accepted.</Text>
          <Button secondary label="Dismiss" disabled={busy} onPress={() => void act(() => closeTrade(t.id, t.iProposed), 'Offer dismissed.')} />
          {!t.iProposed && t.otherId && (
            <Button secondary label="Make a fresh offer" onPress={() => navigation.navigate('TradeBuilder', { friendId: t.otherId!, username: t.otherName, counterOf: t.id })} />
          )}
        </>
      )}
      {t.status === 'countered' && (
        <Text style={styles.sub}>{t.iProposed ? `${t.otherName} countered this with a new offer.` : 'You countered this offer. Your new proposal replaces it.'}</Text>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.lg },
  group: { gap: 2 },
  title: { ...type.title, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  expired: { color: state.error },
}));
