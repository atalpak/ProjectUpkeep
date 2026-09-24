import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createDeck, fetchDeckTiles, type DeckTile } from '../decks';
import { CollectionAuthError } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, EmptyState, Notice } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { ManaSymbol } from '../components/ManaCost';
import { PAGES, type DecksStackParamList } from '../navigation';
import { border, brand, fontFamily, radius, space, state as stateColor, surface, text, type as typeTokens, accent } from '../theme';
import { makeStyles } from '../preferences';

const GAP = space.md;
// The web app's tile proportions (aspect-[9/8]).
const TILE_ASPECT = 9 / 8;

/**
 * The user's decks as tiles, like the web app's deck list: each tile is the
 * commander's art under a dark scrim, with the deck's colour identity, its
 * name, and how much of the list is sleeved into the deck. See src/decks.ts
 * for the queries and why every one scopes on the owner.
 */
export function DecksScreen({ navigation }: NativeStackScreenProps<DecksStackParamList, 'DeckList'>) {
  const styles = useStyles();
  const { userId } = useApp();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const [decks, setDecks] = useState<DeckTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoading(true);
    setError(''); setAuthError(false);
    try {
      const result = await fetchDeckTiles(userId);
      if (alive.current) setDecks(result);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [userId]);
  // Coming back from a deck (where cards get sleeved) refreshes the progress bars.
  const first = useRef(true);
  useEffect(() => {
    if (!focused) return;
    void load(!first.current);
    first.current = false;
  }, [focused, load]);

  async function create() {
    if (!userId || busy) return;
    setBusy(true); setFormError('');
    try {
      await createDeck(userId, name);
      setName(''); setCreating(false);
      await load(true);
    } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
  }

  const tileWidth = (width - space.xl * 2 - GAP) / 2;
  const tileHeight = tileWidth / TILE_ASPECT;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <PageTitle>{PAGES.Decks.title}</PageTitle>
      {loading && <Text style={styles.body}>Loading your decks…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view your decks.</Notice>}
      {!loading && !!error && <>
        <Notice>{error}</Notice>
        <Button secondary label="Retry" onPress={() => void load()} />
      </>}

      {!loading && !authError && !error && (
        <>
          {!creating
            ? <Button secondary label="Start a deck" onPress={() => setCreating(true)} />
            : (
              <View style={styles.form}>
                <TextInput accessibilityLabel="Deck name" style={styles.input} value={name} onChangeText={setName} placeholder="Mono-Red Aggro" placeholderTextColor={text.secondary} maxLength={80} autoFocus returnKeyType="done" onSubmitEditing={() => void create()} />
                {!!formError && <Text style={styles.formError} accessibilityRole="alert">{formError}</Text>}
                <View style={styles.formButtons}>
                  <View style={styles.grow}><Button label={busy ? 'Creating…' : 'Create deck'} loading={busy} disabled={!name.trim()} onPress={() => void create()} /></View>
                  <View style={styles.grow}><Button secondary label="Cancel" disabled={busy} onPress={() => { setCreating(false); setFormError(''); }} /></View>
                </View>
              </View>
            )}

          {!decks.length
            ? (
              <EmptyState title="No decks yet" body="A deck is a real place a card can be. Start one, then sleeve cards into it from your collection.">
                {!creating && <Button label="Start a deck" onPress={() => setCreating(true)} />}
              </EmptyState>
            )
            : (
              <>
                <Text style={styles.count}>{decks.length} deck{decks.length === 1 ? '' : 's'}</Text>
                <View style={styles.grid}>
                  {decks.map(d => <DeckTileView key={d.id} deck={d} width={tileWidth} height={tileHeight} onPress={() => navigation.navigate('DeckDetail', { deckId: d.id })} />)}
                </View>
              </>
            )}
        </>
      )}
    </ScrollView>
  );
}

function DeckTileView({ deck, width, height, onPress }: { deck: DeckTile; width: number; height: number; onPress(): void }) {
  const styles = useStyles();
  const hasArt = !!deck.commanderArt;
  const complete = deck.cardCount > 0 && deck.sleevedCount >= deck.cardCount;
  const fraction = deck.cardCount > 0 ? Math.min(1, deck.sleevedCount / deck.cardCount) : 0;
  // Over art the text is always light on a dark scrim; without art it follows the theme.
  const fg = hasArt ? brand.parchment : text.primary;
  const soft = hasArt ? 'rgba(245,237,224,0.8)' : text.secondary;
  const sub = deck.commanderName ?? `${deck.uniqueCount} unique card${deck.uniqueCount === 1 ? '' : 's'}`;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${deck.name}, ${deck.cardCount ? `${deck.sleevedCount} of ${deck.cardCount} sleeved` : 'empty list'}`} onPress={onPress} style={[styles.tile, { width, height }]}>
      {hasArt
        ? <><Image source={{ uri: deck.commanderArt! }} style={StyleSheet.absoluteFill} resizeMode="cover" /><View style={[StyleSheet.absoluteFill, styles.scrim]} /></>
        : <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.sunken }]} />}
      <View style={styles.tileBody}>
        <View style={styles.tileTop}>
          <View style={styles.pips}>
            {deck.commanderColors.filter(c => c.length === 1 && 'WUBRG'.includes(c)).map(c => <ManaSymbol key={c} code={c} size={20} />)}
          </View>
          {deck.isPublic && <Text style={[styles.shared, { color: fg, borderColor: hasArt ? 'rgba(245,237,224,0.5)' : accent.DEFAULT }]}>Shared</Text>}
        </View>
        <View style={styles.tileBottom}>
          <Text numberOfLines={2} style={[styles.deckName, { color: fg }]}>{deck.name}</Text>
          {deck.cardCount > 0 ? (
            <>
              <View style={[styles.track, { backgroundColor: hasArt ? 'rgba(255,255,255,0.25)' : surface.canvas }]}>
                <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%`, backgroundColor: complete ? stateColor.success : accent.DEFAULT }]} />
              </View>
              <Text numberOfLines={1} style={[styles.meta, { color: soft }]}>{sub}</Text>
              <Text numberOfLines={1} style={[styles.meta, { color: soft }]}>
                {complete ? <Text style={{ color: fg, fontFamily: fontFamily.bodySemiBold }}>Ready to play</Text> : <><Text style={{ color: fg, fontFamily: fontFamily.bodySemiBold }}>{deck.sleevedCount} of {deck.cardCount}</Text> sleeved</>}
              </Text>
            </>
          ) : (
            <>
              <Text numberOfLines={1} style={[styles.meta, { color: soft }]}>{sub}</Text>
              <Text numberOfLines={1} style={[styles.meta, { color: soft }]}>Nothing on the list yet.</Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  body: { ...typeTokens.bodySm, color: text.secondary },
  count: { ...typeTokens.label, color: text.secondary },
  grow: { flex: 1 },
  form: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  input: { height: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...typeTokens.body },
  formButtons: { flexDirection: 'row', gap: space.sm },
  formError: { ...typeTokens.bodySm, color: text.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: border.hairline },
  // The same flat scrim the web tile uses: a crop's bright spot lands somewhere
  // different on every card, and a gradient leaves some names unreadable.
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  tileBody: { flex: 1, padding: space.md, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pips: { flexDirection: 'row', gap: 3 },
  shared: { ...typeTokens.label, fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, overflow: 'hidden' },
  tileBottom: { gap: 3 },
  deckName: { fontFamily: fontFamily.display, fontSize: 17, lineHeight: 21 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 2 },
  fill: { height: '100%', borderRadius: 3 },
  meta: { ...typeTokens.label, fontFamily: fontFamily.body, fontSize: 11, lineHeight: 14 },
}));
