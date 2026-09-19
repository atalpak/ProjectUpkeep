import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { ColorSwatches } from '../components/ColorSwatches';
import { Button, Choices, Notice } from '../components/ui';
import { errorMessage } from '../errors';
import { createLocation, fetchLocations, LOCATION_COLOR_HEX, LOCATION_TYPE_LABELS, LOCATION_TYPES, type LocationColor, type LocationKind, type LocationRow } from '../locations';
import type { LocationsStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { binder: 'book-outline', box: 'cube-outline', other: 'folder-outline' };

/**
 * The user's containers -- binders, boxes, anything else -- with how many
 * cards sit in each. Nested one level (a page inside a binder), like the
 * database allows. Decks are not listed: they have their own tab.
 */
export function LocationsScreen({ navigation }: NativeStackScreenProps<LocationsStackParamList, 'LocationList'>) {
  const styles = useStyles();
  const { userId, reloadLocations } = useApp();
  const focused = useIsFocused();
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [unsorted, setUnsorted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('binder');
  const [parentId, setParentId] = useState<string | null>(null);
  const [color, setColor] = useState<LocationColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setError('');
    try {
      const r = await fetchLocations(userId);
      if (!alive.current) return;
      setRows(r.locations); setUnsorted(r.unsorted);
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { if (focused) void load(); }, [focused, load]);

  async function create() {
    if (!userId || busy) return;
    setBusy(true); setFormError('');
    try {
      await createLocation(userId, { name, type: kind, parentId, color });
      setName(''); setColor(null); setParentId(null); setCreating(false);
      await Promise.all([load(), reloadLocations()]);
    } catch (e) { setFormError(errorMessage(e)); } finally { setBusy(false); }
  }

  const top = rows.filter(r => !r.parentId);
  const childrenOf = (id: string) => rows.filter(r => r.parentId === id);
  const topChoices = top;

  function Row({ row, nested }: { row: LocationRow; nested?: boolean }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.name}, ${row.cardCount} cards`}
        onPress={() => navigation.navigate('LocationDetail', { locationId: row.id, title: row.name })}
        style={[styles.row, nested && styles.nested]}
      >
        <View style={[styles.dot, { backgroundColor: row.color ? LOCATION_COLOR_HEX[row.color] : 'transparent', borderColor: row.color ? 'transparent' : border.strong }]} />
        <Ionicons name={TYPE_ICONS[row.type] ?? 'folder-outline'} size={20} color={text.secondary} />
        <View style={styles.grow}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={styles.sub}>{LOCATION_TYPE_LABELS[row.type] ?? row.type} · {row.cardCount} card{row.cardCount === 1 ? '' : 's'}{row.tradable ? ' · open for trade' : ''}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!!error && <><Notice>{error}</Notice><Button secondary label="Retry" onPress={() => void load()} /></>}
      {loading && <Text style={styles.sub}>Loading your locations…</Text>}

      {!creating
        ? <Button label="New location" onPress={() => setCreating(true)} />
        : (
          <View style={styles.form}>
            <Text style={styles.formTitle}>New location</Text>
            <TextInput accessibilityLabel="Name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Commander binder" placeholderTextColor={text.secondary} maxLength={80} autoFocus />
            <Text style={styles.label}>Type</Text>
            <Choices values={[...LOCATION_TYPES]} selected={kind} labels={LOCATION_TYPE_LABELS} disabled={busy} onSelect={v => setKind(v as LocationKind)} />
            {topChoices.length > 0 && (
              <>
                <Text style={styles.label}>Inside</Text>
                <Choices values={['', ...topChoices.map(t => t.id)]} selected={parentId ?? ''} disabled={busy} onSelect={v => setParentId(v || null)}
                  labels={Object.fromEntries([['', 'Nothing (top level)'], ...topChoices.map(t => [t.id, t.name])])} />
              </>
            )}
            <Text style={styles.label}>Colour</Text>
            <ColorSwatches value={color} onChange={setColor} disabled={busy} />
            {!!formError && <Text style={styles.formError} accessibilityRole="alert">{formError}</Text>}
            <Button label={busy ? 'Creating…' : 'Create'} disabled={busy || !name.trim()} onPress={() => void create()} />
            <Button secondary label="Cancel" disabled={busy} onPress={() => { setCreating(false); setFormError(''); }} />
          </View>
        )}

      {!loading && !error && (
        <>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LocationDetail', { locationId: null, title: 'Unsorted' })} style={styles.row}>
            <View style={[styles.dot, { borderColor: 'transparent' }]} />
            <Ionicons name="shuffle-outline" size={20} color={text.secondary} />
            <View style={styles.grow}>
              <Text style={styles.name}>Unsorted</Text>
              <Text style={styles.sub}>{unsorted} card{unsorted === 1 ? '' : 's'} not filed anywhere yet</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {top.length === 0 && <Text style={styles.sub}>No binders or boxes yet. Make one to start filing cards.</Text>}
          {top.map(t => (
            <View key={t.id} style={styles.group}>
              <Row row={t} />
              {childrenOf(t.id).map(c => <Row key={c.id} row={c} nested />)}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  group: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, minHeight: 56 },
  nested: { marginLeft: space.xxl },
  grow: { flex: 1, gap: 2 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  chevron: { fontSize: 22, color: text.secondary },
  form: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  formTitle: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  label: { ...type.label, color: text.secondary, marginTop: space.sm },
  input: { height: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...type.body },
  formError: { ...type.bodySm, color: text.primary },
}));
