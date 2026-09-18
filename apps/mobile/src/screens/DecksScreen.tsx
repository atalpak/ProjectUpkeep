import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { fetchDecks, type DeckSummary } from '../decks';
import { CollectionAuthError } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, Notice } from '../components/ui';
import { ListRow } from '../components/ListRow';
import type { DecksStackParamList } from '../navigation';
import { space, text, type as typeTokens } from '../theme';

// Read-only list of the signed-in user's own decks. See src/decks.ts for the
// query and why its owner filter (`user_id`, not `owner_user_id`) is
// mandatory rather than a nicety.
export function DecksScreen({ navigation }: NativeStackScreenProps<DecksStackParamList, 'DeckList'>) {
  const { userId } = useApp();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function load() {
    if (!userId) return;
    setLoading(true); setError(''); setAuthError(false);
    try {
      const result = await fetchDecks(userId);
      if (alive.current) setDecks(result);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [userId]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {loading && <Text style={styles.body}>Loading your decks…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your decks.</Notice>}
      {!loading && error && <>
        <Notice>{error}</Notice>
        <Button secondary label="Retry" onPress={() => void load()} />
      </>}
      {!loading && !authError && !error && !decks.length && <Text style={styles.body}>You don&apos;t have any decks yet. Build one on the web app to see it here.</Text>}
      {!loading && !authError && !error && !!decks.length && <>
        <Text style={styles.section}>{decks.length} deck{decks.length === 1 ? '' : 's'}</Text>
        {decks.map(d => (
          <ListRow key={d.id} title={d.name} subtitle={d.format ?? 'No format set'} onPress={() => navigation.navigate('DeckDetail', { deckId: d.id })} />
        ))}
      </>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  section: { ...typeTokens.title, color: text.primary },
  body: { fontSize: 13, lineHeight: 21, color: text.secondary },
});
