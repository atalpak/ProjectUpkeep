import React, { useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Condition, Finish } from '@upkeep/scan-core';
import { fetchDeckCards, fetchDeckHeader, fetchSleevedStacks, fetchSpareStacks, type DeckCardEntry, type DeckHeader, type SleeveCandidate } from '../decks';
import { CollectionAuthError } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, Notice } from '../components/ui';
import { ListRow } from '../components/ListRow';
import type { DecksStackParamList } from '../navigation';
import { border, radius, space, state, surface, text, type as typeTokens } from '../theme';

/**
 * One deck's decklist, with each entry's sleeved-vs-wanted count — see
 * src/decks.ts's header for why that number needs two separate queries. A
 * real stack screen now (React Navigation), so it gets a native back
 * gesture instead of the hand-rolled "‹ Back to decks" button the old
 * single-state-switch shell used.
 */
export function DeckDetailScreen({ route }: NativeStackScreenProps<DecksStackParamList, 'DeckDetail'>) {
  const { deckId } = route.params;
  const { userId, pendingMove, moveBusy, beginMove } = useApp();
  const [header, setHeader] = useState<DeckHeader | null>(null);
  const [cards, setCards] = useState<DeckCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function load() {
    if (!userId) return;
    setLoading(true); setError(''); setAuthError(false);
    try {
      const [h, c] = await Promise.all([fetchDeckHeader(userId, deckId), fetchDeckCards(userId, deckId)]);
      if (!alive.current) return;
      setHeader(h); setCards(c);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [userId, deckId]);

  const moveDisabled = !!pendingMove || moveBusy;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {loading && <Text style={styles.body}>Loading deck…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view this deck.</Notice>}
      {!loading && error && <>
        <Notice>{error}</Notice>
        <Button secondary label="Retry" onPress={() => void load()} />
      </>}
      {!loading && !authError && !error && header && <>
        {header.commanderImageUriSmall && <Image source={{ uri: header.commanderImageUriSmall }} style={styles.thumbnail} />}
        <Text style={styles.section}>{header.name}</Text>
        <Text style={styles.body}>{header.format ?? 'No format set'}{header.commanderName ? ` · Commander: ${header.commanderName}` : ''}</Text>
        {!cards.length && <Text style={styles.body}>This deck&apos;s list is empty.</Text>}
        {cards.map(c => {
          const fullySleeved = c.sleeved >= c.quantity;
          const noneSleeved = c.sleeved === 0;
          const picking = activePicker?.entryId === c.id;
          return (
            <View key={c.id} style={styles.entry}>
              <ListRow
                title={c.name}
                imageUri={c.imageUriSmall}
                dimmed={noneSleeved}
                subtitle={`${c.setCode.toUpperCase()} · #${c.collectorNumber} · Qty ${c.quantity}`}
              />
              <Text style={[styles.sleevedLine, fullySleeved ? styles.sleevedFull : noneSleeved ? styles.sleevedNone : undefined]}>
                {c.sleeved}/{c.quantity} sleeved
              </Text>
              <View style={styles.choices}>
                {!fullySleeved && (
                  <Button secondary label={picking && activePicker?.mode === 'sleeve' ? 'Cancel' : 'Sleeve'} disabled={moveDisabled}
                    onPress={() => setActivePicker(picking && activePicker?.mode === 'sleeve' ? null : { entryId: c.id, mode: 'sleeve' })} />
                )}
                {!noneSleeved && (
                  <Button secondary label={picking && activePicker?.mode === 'unsleeve' ? 'Cancel' : 'Unsleeve'} disabled={moveDisabled}
                    onPress={() => setActivePicker(picking && activePicker?.mode === 'unsleeve' ? null : { entryId: c.id, mode: 'unsleeve' })} />
                )}
              </View>
              {picking && userId && (
                <SleevePicker
                  userId={userId} deckId={deckId} entry={c} mode={activePicker!.mode} onMove={beginMove}
                  onClose={() => setActivePicker(null)}
                  onMoved={() => { setActivePicker(null); void load(); }}
                />
              )}
            </View>
          );
        })}
      </>}
    </ScrollView>
  );
}

// Which entry's sleeve/unsleeve picker is open, if any — only one entry's
// picker is ever open at a time.
type ActivePicker = { entryId: string; mode: 'sleeve' | 'unsleeve' };

/**
 * Lists the candidate stacks for one deck entry's sleeve (spare copies
 * elsewhere) or unsleeve (copies already in this deck) action, and applies
 * the tap through apply_stack_move via `onMove` (AppProvider's beginMove).
 * Stays an in-screen component per the design spec — promoting it to a
 * route buys nothing here, and it needs no swipe-back-to-dismiss the way a
 * real route would offer for free.
 */
function SleevePicker({ userId, deckId, entry, mode, onMove, onClose, onMoved }: {
  userId: string; deckId: string; entry: DeckCardEntry; mode: 'sleeve' | 'unsleeve';
  onMove(draft: { sourceInstanceId: string; cardId: string; condition: Condition; finish: Finish; language: string; quantity: number; destinationLocationId: string | null }, label: string): Promise<{ instanceId: string; quantity: number; replayed: boolean }>;
  onClose(): void; onMoved(): void;
}) {
  const [candidates, setCandidates] = useState<SleeveCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void (async () => {
      try {
        const list = mode === 'sleeve'
          ? await fetchSpareStacks(userId, deckId, entry.oracleId, entry.name)
          : await fetchSleevedStacks(userId, deckId, entry.oracleId, entry.name);
        if (!cancelled) setCandidates(list);
      } catch (e) { if (!cancelled) setError(errorMessage(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, deckId, entry.oracleId, entry.name, mode]);

  async function pick(candidate: SleeveCandidate) {
    if (busy) return;
    setBusy(true); setError('');
    const remaining = Math.max(1, entry.quantity - entry.sleeved);
    const quantity = mode === 'sleeve' ? Math.min(remaining, candidate.quantity) : candidate.quantity;
    const label = `${mode === 'sleeve' ? 'Sleeve' : 'Unsleeve'} ${quantity} ${entry.name} (${candidate.setCode.toUpperCase()} #${candidate.collectorNumber})`;
    try {
      await onMove({
        sourceInstanceId: candidate.id,
        cardId: candidate.cardId,
        condition: candidate.condition as Condition,
        finish: candidate.finish as Finish,
        language: candidate.language,
        quantity,
        destinationLocationId: mode === 'sleeve' ? deckId : null,
      }, label);
      if (alive.current) onMoved();
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }

  return (
    <View style={styles.picker}>
      <Text style={styles.label}>{mode === 'sleeve' ? `Sleeve ${entry.name} from…` : `Unsleeve ${entry.name} to Unsorted from…`}</Text>
      {loading && <Text style={styles.body}>Loading…</Text>}
      {error ? <Notice>{error}</Notice> : null}
      {!loading && !candidates.length && (
        <Text style={styles.body}>
          {mode === 'sleeve' ? 'No spare copies of this card elsewhere in your collection.' : 'Nothing of this card is currently sleeved in this deck.'}
        </Text>
      )}
      {candidates.map(cand => (
        <ListRow
          key={cand.id}
          disabled={busy}
          onPress={() => void pick(cand)}
          title={`${cand.setCode.toUpperCase()} · #${cand.collectorNumber} · Qty ${cand.quantity}`}
          subtitle={`${cand.condition.toUpperCase()} · ${cand.finish.toUpperCase()} · ${cand.language.toUpperCase()} · ${cand.locationName}`}
        />
      ))}
      <Button secondary label="Close" disabled={busy} onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  section: { ...typeTokens.title, color: text.primary },
  body: { fontSize: 13, lineHeight: 21, color: text.secondary },
  label: { fontSize: 13, fontWeight: '700', color: text.primary, marginTop: space.sm },
  thumbnail: { width: 45, height: 63, borderRadius: 3 },
  entry: { gap: space.sm },
  sleevedLine: { fontSize: 13, lineHeight: 21, color: text.secondary },
  sleevedFull: { color: state.success, fontWeight: '700' },
  sleevedNone: { color: text.secondary },
  choices: { flexDirection: 'row', gap: space.sm },
  picker: { gap: space.sm, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, padding: space.lg, borderRadius: radius.md },
});
