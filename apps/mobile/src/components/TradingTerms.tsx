import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { TERMS_URL } from '../auth';
import { errorMessage } from '../errors';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';
import { acceptTos } from '../tos';
import { Button, Notice } from './ui';

/**
 * The trading-terms gate, shown in place of propose/accept until the current
 * terms are accepted. The substance is on the panel rather than behind the
 * link, matching the web's TradingTerms. It is a courtesy: acceptTrade and
 * proposeTrade in src/trades.ts check acceptance regardless of what renders.
 */
export function TradingTerms({ onAccepted }: { onAccepted(): void }) {
  const styles = useStyles();
  const { userId } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function agree() {
    if (!userId || busy) return;
    setBusy(true); setError('');
    try { await acceptTos(userId); onAccepted(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Before you trade</Text>
      <Text style={styles.body}>Trading is between you and the other user. Accept these terms once to start.</Text>
      <Text style={styles.body}>• A trade is an agreement with another user. Project Upkeep is not a party to it.</Text>
      <Text style={styles.body}>• We are not liable for a trade. Delivery, condition and disputes are between the two of you. The app is provided as-is.</Text>
      <Text style={styles.body}>• Accepting a trade moves the cards between both collections immediately, and there is no automated reversal.</Text>
      {!!error && <Notice>{error}</Notice>}
      <Button label={busy ? 'Saving…' : 'I agree to the trading terms'} disabled={busy} onPress={() => void agree()} />
      <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>Read the full terms</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  panel: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.strong },
  title: { ...type.title, color: text.primary },
  body: { ...type.bodySm, color: text.secondary },
  link: { ...type.bodySm, color: text.primary, textDecorationLine: 'underline', textAlign: 'center' },
}));
