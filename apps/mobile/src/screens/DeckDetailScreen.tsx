import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Condition, Finish } from '@upkeep/scan-core';
import { groupDeck } from '@upkeep/domain';
import { deleteDeck, entryKey, fetchDeckCards, fetchDeckHeader, fetchSleevedStacks, fetchSpareCounts, fetchSpareStacks, setDeckPublic, updateDeckDetails, type DeckCardEntry, type DeckHeader, type SleeveCandidate } from '../decks';
import { CollectionAuthError } from '../collection';
import { errorMessage } from '../errors';
import { useApp } from '../AppProvider';
import { Button, DismissingNotice, Notice } from '../components/ui';
import { DeckDetailsEditor } from '../components/DeckDetailsEditor';
import { CardDetails } from '../components/CardDetails';
import { ManaCost } from '../components/ManaCost';
import { ListRow } from '../components/ListRow';
import type { DecksStackParamList } from '../navigation';
import { accent, border, brand, fontFamily, radius, space, state, surface, text, type as typeTokens } from '../theme';
import { makeStyles } from '../preferences';

/**
 * One deck's decklist, with each entry's sleeved-vs-wanted count — see
 * src/decks.ts's header for why that number needs two separate queries. A
 * real stack screen now (React Navigation), so it gets a native back
 * gesture instead of the hand-rolled "‹ Back to decks" button the old
 * single-state-switch shell used.
 */
export function DeckDetailScreen({ route, navigation }: NativeStackScreenProps<DecksStackParamList, 'DeckDetail'>) {
  const styles = useStyles();
  const { deckId } = route.params;
  const { userId, pendingMove, moveBusy, beginMove, reloadLocations } = useApp();
  const [header, setHeader] = useState<DeckHeader | null>(null);
  const [cards, setCards] = useState<DeckCardEntry[]>([]);
  const [spare, setSpare] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [details, setDetails] = useState<{ name: string; cardId: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function saveDetails(input: { name: string; format: string; tags: string[]; notes: string }) {
    await updateDeckDetails(userId!, deckId, input);
    if (!alive.current) return;
    setEditing(false); setNotice('Details saved.');
    await Promise.all([load(true), reloadLocations()]);
  }

  async function toggleShared(next: boolean) {
    if (!userId || manageBusy) return;
    setManageBusy(true); setManageError('');
    try {
      await setDeckPublic(userId, deckId, next);
      if (alive.current) setHeader(h => (h ? { ...h, isPublic: next } : h));
    } catch (e) { if (alive.current) setManageError(errorMessage(e)); }
    finally { if (alive.current) setManageBusy(false); }
  }

  function confirmDelete() {
    if (!header) return;
    Alert.alert(`Delete ${header.name}?`, 'The cards sleeved into it are not deleted. They go back to Unsorted and are free to use again. The deck and its list are gone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete deck', style: 'destructive', onPress: () => void (async () => {
        if (!userId || manageBusy) return;
        setManageBusy(true); setManageError('');
        try {
          await deleteDeck(userId, deckId);
          await reloadLocations();
          if (alive.current) navigation.goBack();
        } catch (e) { if (alive.current) { setManageError(errorMessage(e)); setManageBusy(false); } }
      })() },
    ]);
  }

  async function load(silent = false) {
    if (!userId) return;
    if (!silent) setLoading(true);
    setError(''); setAuthError(false);
    try {
      const [h, c, sp] = await Promise.all([fetchDeckHeader(userId, deckId), fetchDeckCards(userId, deckId), fetchSpareCounts(userId)]);
      if (!alive.current) return;
      setHeader(h); setCards(c); setSpare(sp);
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

  // Per entry: sleeved in full, or not, and if not whether spare copies exist elsewhere.
  function stateOf(c: DeckCardEntry): 'sleeved' | 'partial' | 'available' | 'missing' {
    if (c.sleeved >= c.quantity) return 'sleeved';
    const need = c.quantity - c.sleeved;
    if ((spare.get(entryKey(c)) ?? 0) >= need) return c.sleeved > 0 ? 'partial' : 'available';
    return 'missing';
  }

  const wanted = cards.reduce((sum, c) => sum + c.quantity, 0);
  const sleevedTotal = cards.reduce((sum, c) => sum + c.sleeved, 0);
  const missingEntries = cards.filter(c => stateOf(c) === 'missing').length;
  const commanderEntry = header?.commanderCardId ? cards.find(c => c.cardId === header.commanderCardId) ?? null : null;
  const groups = groupDeck(cards, commanderEntry?.id ?? null);

  function stateLine(c: DeckCardEntry): { text: string; tone: 'good' | 'plain' | 'bad' } {
    switch (stateOf(c)) {
      case 'sleeved': return { text: c.quantity > 1 ? `${c.sleeved} of ${c.quantity} sleeved` : 'Sleeved', tone: 'good' };
      case 'partial': return { text: `${c.sleeved} of ${c.quantity} sleeved · spare available`, tone: 'plain' };
      case 'available': return { text: 'Not sleeved · spare available', tone: 'plain' };
      default: return { text: c.sleeved > 0 ? `${c.sleeved} of ${c.quantity} sleeved · not available` : 'Not sleeved · not available', tone: 'bad' };
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {loading && <Text style={styles.body}>Loading deck…</Text>}
      {authError && <Notice>Your session is no longer valid. Sign out and sign in again to view this deck.</Notice>}
      {!loading && error && <>
        <Notice>{error}</Notice>
        <Button secondary label="Retry" onPress={() => void load()} />
      </>}
      {!loading && !authError && !error && header && <>
        {/* This banner is the page's title -- no native header (App.tsx's
            DecksNavigator turns it off) and no PageTitle either, since the
            brief's own rule is one title per screen and this already gives
            plenty of hierarchy. */}
        <View style={styles.banner}>
          {header.commanderArt
            ? <><Image source={{ uri: header.commanderArt }} style={StyleSheet.absoluteFill} resizeMode="cover" /><View style={[StyleSheet.absoluteFill, styles.scrim]} /></>
            : <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.sunken }]} />}
          <View style={styles.bannerBody}>
            <Text style={[styles.deckTitle, { color: header.commanderArt ? brand.parchment : text.primary }]}>{header.name}</Text>
            <Text style={[styles.commander, { color: header.commanderArt ? 'rgba(245,237,224,0.85)' : text.secondary }]}>
              {header.commanderName ?? `${cards.length} unique card${cards.length === 1 ? '' : 's'}`}
            </Text>
            <View style={styles.pills}>
              {!!header.format && <Pill label={header.format} art={!!header.commanderArt} />}
              {header.tags.map(t => <Pill key={t} label={t} art={!!header.commanderArt} />)}
              <Pill label={header.isPublic ? 'Shared with friends' : 'Private'} art={!!header.commanderArt} strong={header.isPublic} />
            </View>
            <Text style={[styles.progress, { color: header.commanderArt ? brand.parchment : text.primary }]}>
              <Text style={styles.progressStrong}>{sleevedTotal} of {wanted}</Text> sleeved · {cards.length} card{cards.length === 1 ? '' : 's'} on the list
              {missingEntries > 0 ? ` · ${missingEntries} not available` : ''}
            </Text>
          </View>
        </View>

        {!!notice && <DismissingNotice onDone={() => setNotice('')}>{notice}</DismissingNotice>}
        {!!header.notes && !editing && <Text style={styles.body}>{header.notes}</Text>}
        {!!manageError && <Notice>{manageError}</Notice>}
        {editing
          ? <DeckDetailsEditor initial={{ name: header.name, format: header.format ?? '', tags: header.tags, notes: header.notes ?? '' }} onSave={saveDetails} onCancel={() => setEditing(false)} />
          : (
            <View style={styles.manage}>
              <View style={styles.switchRow}>
                <View style={styles.grow}>
                  <Text style={styles.strong}>Share with friends</Text>
                  <Text style={styles.body}>Friends can see this deck&apos;s list. They never see which copies you have sleeved into it.</Text>
                </View>
                <Switch value={header.isPublic} onValueChange={v => void toggleShared(v)} disabled={manageBusy} accessibilityLabel="Share with friends" />
              </View>
              <Button secondary label="Edit name, format, tags and notes" disabled={manageBusy} onPress={() => setEditing(true)} />
              <Button secondary label="Delete deck" disabled={manageBusy} onPress={confirmDelete} />
            </View>
          )}

        {!cards.length && <Text style={styles.body}>This deck&apos;s list is empty.</Text>}

        {groups.map(group => (
          <View key={group.section} style={styles.group}>
            <Text style={styles.groupTitle}>{group.label} <Text style={styles.groupCount}>({group.count})</Text></Text>
            {group.rows.map(c => {
              const fullySleeved = c.sleeved >= c.quantity;
              const line = stateLine(c);
              const picking = activePicker?.entryId === c.id;
              return (
                <View key={c.id}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${c.name}, details`} onPress={() => setDetails({ name: c.name, cardId: c.cardId })} style={styles.row}>
                    <Text style={styles.qty}>{c.quantity}</Text>
                    <View style={styles.rowMain}>
                      <View style={styles.rowTop}>
                        <Text numberOfLines={1} style={styles.cardName}>{c.name}</Text>
                        <ManaCost cost={c.manaCost} size={15} />
                      </View>
                      <Text numberOfLines={1} style={[styles.stateText, line.tone === 'good' && styles.stateGood, line.tone === 'bad' && styles.stateBad]}>{line.text}</Text>
                    </View>
                    <View style={styles.rowActions}>
                      {!fullySleeved && (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Sleeve ${c.name}`} disabled={moveDisabled} onPress={() => setActivePicker(picking && activePicker?.mode === 'sleeve' ? null : { entryId: c.id, mode: 'sleeve' })} style={[styles.actionPill, picking && activePicker?.mode === 'sleeve' && styles.actionPillOn, moveDisabled && styles.actionPillDisabled]}>
                          <Text style={styles.actionText}>{picking && activePicker?.mode === 'sleeve' ? 'Cancel' : 'Sleeve'}</Text>
                        </Pressable>
                      )}
                      {c.sleeved > 0 && (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Unsleeve ${c.name}`} disabled={moveDisabled} onPress={() => setActivePicker(picking && activePicker?.mode === 'unsleeve' ? null : { entryId: c.id, mode: 'unsleeve' })} style={[styles.actionPill, picking && activePicker?.mode === 'unsleeve' && styles.actionPillOn, moveDisabled && styles.actionPillDisabled]}>
                          <Text style={styles.actionText}>{picking && activePicker?.mode === 'unsleeve' ? 'Cancel' : 'Unsleeve'}</Text>
                        </Pressable>
                      )}
                    </View>
                  </Pressable>
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
          </View>
        ))}
      </>}
      <CardDetails name={details?.name ?? null} printingId={details?.cardId} onClose={() => setDetails(null)} />
    </ScrollView>
  );
}

function Pill({ label, art, strong }: { label: string; art: boolean; strong?: boolean }) {
  const styles = useStyles();
  return (
    <Text style={[styles.pill, art ? styles.pillArt : styles.pillPlain, strong && (art ? styles.pillArtStrong : styles.pillPlainStrong)]}>{label}</Text>
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
  const styles = useStyles();
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
          imageUri={cand.imageSmall}
        />
      ))}
      <Button secondary label="Close" disabled={busy} onPress={onClose} />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  manage: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1 },
  strong: { ...typeTokens.title, fontSize: 15, color: text.primary },
  body: { fontSize: 13, lineHeight: 21, color: text.secondary },
  label: { fontSize: 13, fontWeight: '700', color: text.primary, marginTop: space.sm },
  banner: { borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: border.hairline },
  // The same flat scrim the web banner uses, for the same reason.
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)' },
  bannerBody: { padding: space.lg, gap: space.sm },
  deckTitle: { fontFamily: fontFamily.display, fontSize: 26, lineHeight: 32 },
  commander: { ...typeTokens.body },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pill: { ...typeTokens.label, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, overflow: 'hidden' },
  pillArt: { color: 'rgba(245,237,224,0.9)', borderColor: 'rgba(245,237,224,0.4)' },
  pillArtStrong: { backgroundColor: 'rgba(245,237,224,0.2)', borderColor: 'rgba(245,237,224,0.7)' },
  pillPlain: { color: text.secondary, borderColor: border.strong },
  pillPlainStrong: { color: text.primary, backgroundColor: accent.soft, borderColor: accent.DEFAULT },
  progress: { ...typeTokens.bodySm },
  progressStrong: { fontFamily: fontFamily.bodySemiBold },
  group: { gap: 0, marginTop: space.sm },
  groupTitle: { ...typeTokens.title, fontSize: 16, lineHeight: 22, color: text.primary, marginBottom: space.xs },
  groupCount: { ...typeTokens.bodySm, color: text.secondary },
  // A compact list row: quantity, name and mana cost, one line of state, small actions.
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border.hairline },
  qty: { width: 20, ...typeTokens.title, fontSize: 15, color: text.secondary, textAlign: 'right' },
  rowMain: { flex: 1, gap: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  cardName: { flex: 1, ...typeTokens.body, fontFamily: typeTokens.title.fontFamily, color: text.primary },
  stateText: { ...typeTokens.label, fontFamily: fontFamily.body, color: text.secondary },
  stateGood: { color: state.success },
  stateBad: { color: state.error },
  rowActions: { gap: 4, alignItems: 'flex-end' },
  actionPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: border.strong },
  actionPillOn: { backgroundColor: accent.soft, borderColor: accent.DEFAULT },
  actionPillDisabled: { opacity: 0.4 },
  actionText: { ...typeTokens.label, color: text.primary },
  picker: { gap: space.sm, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, padding: space.lg, borderRadius: radius.md, marginVertical: space.sm },
}));
