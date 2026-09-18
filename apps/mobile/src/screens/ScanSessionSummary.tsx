import React, { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CONDITIONS, LANGUAGES, type CardIndex, type Candidate, type CollectionDraft, type Condition, type Finish, type Printing } from '@upkeep/scan-core';
import { Button, Choices } from '../components/ui';
import { ListRow } from '../components/ListRow';
import { MortStage } from '../mort/MortStage';
import type { StagedCard } from './ScanScreen';
import { border, radius, space, surface, text as textColor, type as typeTokens } from '../theme';

type Location = { id: string; name: string };

/**
 * The session-review screen — ManaBox's "N cards scanned" overview. Nothing
 * here is written to the database: every row is a `StagedCard` still living
 * only in ScanScreen's state, so edit/delete are synchronous local mutations
 * and "Add to" is the one action that actually commits (see ScanScreen's
 * commitAll). Rendered by ScanScreen behind `sessionReviewOpen` rather than
 * a nav route, for the same reason the old ReviewCard stayed in-screen:
 * nothing here should be casually swiped away mid-review.
 *
 * Price is deliberately absent from each row: `Printing` (packages/scan-core)
 * carries no price field, and the mobile catalog bundle has no Scryfall
 * price data wired in anywhere the way `src/lib/scryfall.ts` does for the
 * web app — showing a price here would mean inventing a new fetch path,
 * which this pass was explicitly told not to do.
 */
export function ScanSessionSummary({
  staged, locations, index, committing, onEdit, onDelete, onClear, onCommit, onAddManual, onScanMore, onMessage,
}: {
  staged: StagedCard[];
  locations: Location[];
  index: CardIndex;
  committing: boolean;
  onEdit(id: string, patch: Partial<CollectionDraft>): void;
  onDelete(id: string): void;
  onClear(): void;
  onCommit(): void;
  onAddManual(printing: Printing): void;
  onScanMore(): void;
  onMessage(text: string): void;
}) {
  // The app shell no longer supplies a top inset while the scanner is
  // full-bleed, so this screen has to keep its own header clear of the notch.
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<StagedCard | null>(null);
  const [query, setQuery] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);

  const filtered = query.trim()
    ? staged.filter(s => s.printing.name.toLowerCase().includes(query.trim().toLowerCase()))
    : staged;

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + space.md }]}>
      <View style={styles.header}>
        <MortStage size="S" />
        <View style={styles.grow}>
          <Text style={styles.section}>{staged.length} card{staged.length === 1 ? '' : 's'} scanned</Text>
          <Text style={styles.body}>Nothing here is saved yet — review, then Add to your collection.</Text>
        </View>
        <Button secondary label="Camera" disabled={committing} onPress={onScanMore} />
      </View>

      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Filter this session"
          style={[styles.input, styles.grow]}
          placeholder="Filter by name"
          value={query}
          onChangeText={setQuery}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Add a card by name" disabled={committing} style={styles.addButton} onPress={() => setAddingOpen(true)}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
      </View>

      {addingOpen && (
        <ManualAddSheet
          index={index}
          onAdd={printing => { onAddManual(printing); setAddingOpen(false); }}
          onCancel={() => setAddingOpen(false)}
        />
      )}

      {editing && (
        <EditSheet
          item={editing}
          locations={locations}
          onCancel={() => setEditing(null)}
          onSave={patch => { onEdit(editing.id, patch); setEditing(null); }}
          onMessage={onMessage}
        />
      )}

      {!staged.length && <Text style={styles.body}>Nothing scanned yet. Point the camera at a card, or add one by name above.</Text>}
      {!!staged.length && !filtered.length && <Text style={styles.body}>No staged card matches "{query}".</Text>}
      {filtered.map(item => (
        <View key={item.id} style={styles.stagedRow}>
          <Pressable style={styles.grow} disabled={committing} onPress={() => setEditing(item)}>
            <ListRow
              title={item.printing.name}
              subtitle={rowSubtitle(item)}
              imageUri={item.printing.imageUri}
            />
          </Pressable>
          <View style={styles.rowActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.printing.name}`} disabled={committing} style={styles.iconButton} onPress={() => setEditing(item)}>
              <Text style={styles.iconText}>✎</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.printing.name}`} disabled={committing} style={styles.iconButton} onPress={() => onDelete(item.id)}>
              <Text style={styles.iconText}>🗑</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={styles.footer}>
        <View style={styles.grow}><Button secondary label="Clear" disabled={!staged.length || committing} onPress={onClear} /></View>
        <View style={styles.grow}><Button label={committing ? 'Adding…' : `Add to collection (${staged.length})`} disabled={!staged.length || committing} onPress={onCommit} /></View>
      </View>
    </ScrollView>
  );
}

function rowSubtitle(item: StagedCard): string {
  const uncertain = item.band === 'uncertain' ? ' · verify printing' : '';
  return `${item.printing.setCode.toUpperCase()} #${item.printing.collectorNumber} · qty ${item.draft.quantity} · ${item.draft.finish}/${item.draft.condition} · ${item.draft.language.toUpperCase()}${uncertain}`;
}

/** Manual "+" add — the old idle screen's find-a-card-by-name search, moved
 * here per the rebuild spec: a live camera has no room for a search form,
 * and a real card sometimes doesn't scan cleanly. */
function ManualAddSheet({ index, onAdd, onCancel }: { index: CardIndex; onAdd(printing: Printing): void; onCancel(): void }) {
  const [name, setName] = useState('');
  const [setCode, setSetCode] = useState('');
  const [collectorNumber, setCollectorNumber] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);

  function runSearch(n: string, sc: string, cn: string) {
    const { results: r, total: t } = index.searchWithTotal(n, {}, {
      ...(sc.trim() ? { setCode: sc.trim() } : {}),
      ...(cn.trim() ? { collectorNumber: cn.trim() } : {}),
    });
    setResults(r); setTotal(t);
  }

  return (
    <View style={styles.sheet}>
      <Text style={styles.label}>Find a card by name</Text>
      <TextInput
        accessibilityLabel="Card name"
        style={styles.input}
        placeholder="Enter the full card name"
        value={name}
        onChangeText={t => { setName(t); runSearch(t, setCode, collectorNumber); }}
      />
      <View style={styles.row}>
        <TextInput accessibilityLabel="Set code" style={[styles.input, styles.grow]} placeholder="Set (optional)" autoCapitalize="characters" value={setCode} onChangeText={t => { setSetCode(t); runSearch(name, t, collectorNumber); }} />
        <TextInput accessibilityLabel="Collector number" style={[styles.input, styles.grow]} placeholder="# (optional)" value={collectorNumber} onChangeText={t => { setCollectorNumber(t); runSearch(name, setCode, t); }} />
      </View>
      {total > results.length && <Text style={styles.body}>Showing {results.length} of {total} matched — narrow with a set code or collector number.</Text>}
      {results.map(c => (
        <Pressable key={c.printing.id} onPress={() => onAdd(c.printing)}>
          <ListRow
            title={c.printing.name}
            subtitle={`${c.printing.setName ?? c.printing.setCode.toUpperCase()} · #${c.printing.collectorNumber} · ${c.printing.language.toUpperCase()}`}
            imageUri={c.printing.imageUri}
          />
        </Pressable>
      ))}
      {name.length > 1 && !results.length && <Text style={styles.body}>No match in this catalog. Check the name or spelling.</Text>}
      <Button secondary label="Cancel" onPress={onCancel} />
    </View>
  );
}

function EditSheet({ item, locations, onCancel, onSave, onMessage }: {
  item: StagedCard; locations: Location[];
  onCancel(): void; onSave(patch: Partial<CollectionDraft>): void; onMessage(text: string): void;
}) {
  const [finish, setFinish] = useState<Finish>(item.draft.finish);
  const [condition, setCondition] = useState<Condition>(item.draft.condition);
  const [language, setLanguage] = useState(item.draft.language);
  const [location, setLocation] = useState<string | null>(item.draft.location_id);
  const [quantity, setQuantity] = useState(String(item.draft.quantity));

  function save() {
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) { onMessage('Quantity must be a whole number of at least 1.'); return; }
    onSave({ finish, condition, language, location_id: location, quantity: qty });
  }

  return (
    <View style={styles.sheet}>
      <Text style={styles.section}>{item.printing.name}</Text>
      <Text style={styles.label}>Finish</Text>
      <Choices values={item.printing.finishes} selected={finish} onSelect={v => setFinish(v as Finish)} />
      <Text style={styles.label}>Condition</Text>
      <Choices values={[...CONDITIONS]} selected={condition} onSelect={v => setCondition(v as Condition)} />
      <Text style={styles.label}>Language</Text>
      <Choices values={[...LANGUAGES]} selected={language} onSelect={setLanguage} />
      <Text style={styles.label}>Destination</Text>
      <Choices
        values={['', ...locations.map(l => l.id)]}
        selected={location ?? ''}
        onSelect={v => setLocation(v || null)}
        labels={Object.fromEntries([['', 'Unsorted'], ...locations.map(l => [l.id, l.name])])}
      />
      <Text style={styles.label}>Quantity</Text>
      <TextInput accessibilityLabel="Quantity" style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
      <Button label="Save" onPress={save} />
      <Button secondary label="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  section: { ...typeTokens.title, color: textColor.primary },
  body: { ...typeTokens.body, fontSize: 13, lineHeight: 21, color: textColor.secondary },
  label: { fontSize: 13, fontWeight: '700', color: textColor.primary, marginTop: space.sm },
  input: { backgroundColor: surface.canvas, borderColor: border.hairline, borderWidth: 1, borderRadius: radius.sm + 2, padding: 14, color: textColor.primary, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  grow: { flex: 1 },
  addButton: { width: 48, height: 48, borderRadius: radius.sm + 2, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { fontSize: 22, fontWeight: '700', color: textColor.primary },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowActions: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 15 },
  footer: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheet: { gap: space.sm, backgroundColor: surface.raised, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: border.hairline },
});
