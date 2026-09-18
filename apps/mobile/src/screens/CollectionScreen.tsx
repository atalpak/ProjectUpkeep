import React, { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CollectionAuthError, fetchCollectionPage, type CollectionEntry } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, Notice } from '../components/ui';
import { border, radius, space, surface, text, type as typeTokens } from '../theme';

// Read-only browse of the signed-in user's own collection. See
// src/collection.ts for the query itself and why it targets the
// collection_entries view rather than card_instances directly.
export function CollectionScreen() {
  const { userId } = useApp();
  if (!userId) return null; // App.tsx only mounts the tab navigator once signed in.
  return <CollectionList userId={userId} />;
}

function CollectionList({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [page, setPage] = useState(0);
  const [totalEntries, setTotalEntries] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const lastAttempted = useRef(0);

  async function loadPage(nextPage: number) {
    lastAttempted.current = nextPage;
    nextPage === 0 ? setLoading(true) : setLoadingMore(true);
    setError(''); setAuthError(false);
    try {
      const result = await fetchCollectionPage(userId, nextPage);
      if (!alive.current) return;
      setEntries(prev => nextPage === 0 ? result.entries : [...prev, ...result.entries]);
      if (result.totalEntries !== null) setTotalEntries(result.totalEntries);
      setPage(nextPage);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) { setLoading(false); setLoadingMore(false); }
    }
  }
  useEffect(() => { void loadPage(0); }, [userId]);

  const cardsLoaded = entries.reduce((sum, e) => sum + e.quantity, 0);
  const hasMore = totalEntries !== null && entries.length < totalEntries;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {loading && <Text style={styles.body}>Loading your collection…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your collection.</Notice>}
      {!loading && error && <>
        <Notice>{error}</Notice>
        <Button secondary label="Retry" onPress={() => void loadPage(lastAttempted.current)} />
      </>}
      {!loading && !authError && !error && !entries.length && <Text style={styles.body}>You don&apos;t own any cards yet. Scan one to get started.</Text>}
      {!loading && !authError && !error && !!entries.length && <>
        <Text style={styles.section}>{cardsLoaded}{hasMore ? '+' : ''} cards across {totalEntries} entries</Text>
        {entries.map(e => (
          <View key={e.id} style={styles.result}>
            {e.card_image_uri_small && <Image source={{ uri: e.card_image_uri_small }} style={styles.thumbnail} />}
            <View style={styles.grow}>
              <Text style={styles.resultTitle}>{e.card_name}</Text>
              <Text style={styles.body}>{e.card_set_code.toUpperCase()} · #{e.card_collector_number}</Text>
              <Text style={styles.body}>{e.condition.toUpperCase()} · {e.finish.toUpperCase()} · {e.language.toUpperCase()} · Qty {e.quantity} · {e.location_name ?? 'Unsorted'}</Text>
            </View>
          </View>
        ))}
        {hasMore && <Button secondary label={loadingMore ? 'Loading…' : 'Load more'} disabled={loadingMore} onPress={() => void loadPage(page + 1)} />}
      </>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  section: { ...typeTokens.title, color: text.primary },
  body: { fontSize: 13, lineHeight: 21, color: text.secondary },
  result: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, padding: 14, borderRadius: radius.md },
  resultTitle: { fontSize: 16, fontWeight: '600', color: text.primary },
  thumbnail: { width: 45, height: 63, borderRadius: 3 },
  grow: { flex: 1 },
});
