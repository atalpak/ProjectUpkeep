import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useApp } from '../AppProvider';
import { CardDetails } from '../components/CardDetails';
import { ColorSwatches } from '../components/ColorSwatches';
import { PageTitle } from '../components/PageTitle';
import { Button, Choices, GroupRow, ListGroup, Notice, TextField } from '../components/ui';
import { FlipThumb } from '../components/FlipThumb';
import { errorMessage } from '../errors';
import { deleteLocation, fetchLocationCards, fetchLocations, LOCATION_TYPE_LABELS, LOCATION_TYPES, setLocationTradable, updateLocation, type LocationCard, type LocationColor, type LocationKind, type LocationRow } from '../locations';
import type { LocationsStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';

/** One container: its cards, plus (for a real location) editing, the trade switch and delete. */
export function LocationDetailScreen({ route, navigation }: NativeStackScreenProps<LocationsStackParamList, 'LocationDetail'>) {
  const styles = useStyles();
  const { locationId } = route.params;
  const { userId, reloadLocations } = useApp();
  const [location, setLocation] = useState<LocationRow | null>(null);
  const [cards, setCards] = useState<LocationCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('binder');
  const [color, setColor] = useState<LocationColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<LocationCard | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setError('');
    try {
      const [list, all] = await Promise.all([fetchLocationCards(userId, locationId), locationId ? fetchLocations(userId) : Promise.resolve(null)]);
      if (!alive.current) return;
      setCards(list);
      if (all) {
        const row = all.locations.find(l => l.id === locationId) ?? null;
        setLocation(row);
        if (row) { setName(row.name); setKind((LOCATION_TYPES as readonly string[]).includes(row.type) ? row.type as LocationKind : 'other'); setColor(row.color); }
      }
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId, locationId]);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const save = () => run(async () => {
    await updateLocation(userId!, locationId!, { name, type: kind, color });
    navigation.setParams({ title: name.trim() });
    setEditing(false);
    await Promise.all([load(), reloadLocations()]);
  });

  const toggleTradable = (next: boolean) => run(async () => {
    await setLocationTradable(userId!, locationId!, next);
    setLocation(l => (l ? { ...l, tradable: next } : l));
  });

  function confirmDelete() {
    if (!location) return;
    Alert.alert(`Delete ${location.name}?`, 'The cards in it are not deleted. They become unsorted, and anything nested inside moves to the top level.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(async () => { await deleteLocation(userId!, location.id); await reloadLocations(); navigation.goBack(); }) },
    ]);
  }

  const total = cards.reduce((sum, c) => sum + c.quantity, 0);
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {/* This detail screen has no hero/banner art the way DeckDetail does, so
          it needs its own title now the native header (which used to carry
          route.params.title) is off -- see App.tsx's LocationsNavigator. Kept
          in sync with the location's real name via navigation.setParams on save. */}
      <PageTitle>{route.params.title}</PageTitle>
      {!!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}

      {locationId && location && (
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <Text style={styles.strong}>Open for trade</Text>
              <Text style={styles.sub}>Friends can see the cards in here and ask to trade for them. Nothing else you own is visible to anyone.</Text>
            </View>
            <Switch value={location.tradable} onValueChange={v => void toggleTradable(v)} disabled={busy} accessibilityLabel="Open for trade" />
          </View>
          {!editing
            ? <Button secondary label="Edit details" onPress={() => setEditing(true)} />
            : (
              <View style={styles.form}>
                <Text style={styles.label}>Name</Text>
                <TextField tone="canvas" accessibilityLabel="Name" value={name} onChangeText={setName} maxLength={80} />
                <Text style={styles.label}>Type</Text>
                <Choices values={[...LOCATION_TYPES]} selected={kind} labels={LOCATION_TYPE_LABELS} disabled={busy} onSelect={v => setKind(v as LocationKind)} />
                <Text style={styles.label}>Colour</Text>
                <ColorSwatches value={color} onChange={setColor} disabled={busy} />
                <Button label={busy ? 'Saving…' : 'Save'} loading={busy} disabled={!name.trim()} onPress={() => void save()} />
                <Button secondary label="Cancel" disabled={busy} onPress={() => setEditing(false)} />
              </View>
            )}
        </View>
      )}

      {loading ? <Text style={styles.sub}>Loading…</Text> : (
        <>
          <Text style={styles.heading}>{total} card{total === 1 ? '' : 's'}{cards.length !== total ? ` in ${cards.length} entries` : ''}</Text>
          {cards.length === 0 && <Text style={styles.sub}>{locationId ? 'Nothing is filed here yet.' : 'Everything you own is filed somewhere.'}</Text>}
          <ListGroup>
            {cards.map(c => (
              <GroupRow key={c.id} accessibilityLabel={`${c.name}, details`} onPress={() => setDetails(c)}>
                <FlipThumb card={{ name: c.name, layout: c.layout, imageSmall: c.imageSmall }} thumbStyle={styles.thumb}>
                  {name => (
                    <View style={styles.grow}>
                      <Text style={styles.strong}>{name}</Text>
                      <Text style={styles.sub}>{c.setCode.toUpperCase()} · #{c.collectorNumber}</Text>
                      <Text style={styles.sub}>{c.condition.toUpperCase()} · {c.finish.toUpperCase()} · {c.language.toUpperCase()} · Qty {c.quantity}</Text>
                    </View>
                  )}
                </FlipThumb>
              </GroupRow>
            ))}
          </ListGroup>
        </>
      )}

      {locationId && location && <Button secondary label="Delete this location" disabled={busy} onPress={confirmDelete} />}
      <CardDetails name={details?.name ?? null} printingId={details?.cardId} ownedFinish={details?.finish} onClose={() => { setDetails(null); void load(); }} />
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  form: { gap: space.sm },
  heading: { ...type.title, color: text.primary },
  strong: { ...type.rowTitle, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  label: { ...type.label, color: text.secondary, marginTop: space.sm },
  thumb: { width: 56, height: 78, borderRadius: radius.thumb, backgroundColor: surface.sunken },
}));
