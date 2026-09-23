import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CONDITIONS, LANGUAGES, finishSummary, thumbnailUri, type CardIndex, type Candidate, type CollectionDraft, type Condition, type Finish, type Printing } from '@upkeep/scan-core';
import { isSameCard, reconcileFinish } from '@upkeep/domain';
import { Button, Choices } from '../components/ui';
import { ListRow } from '../components/ListRow';
import { MortStage } from '../mort/MortStage';
import type { StagedCard } from './ScanScreen';
import { border, fontFamily, radius, space, surface, text as textColor, type as typeTokens } from '../theme';
import { makeStyles } from '../preferences';

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
  staged, locations, index, committing, onEdit, onChangePrinting, onDelete, onClear, onCommit, onAddManual, onScanMore, onMessage,
}: {
  staged: StagedCard[];
  locations: Location[];
  index: CardIndex;
  committing: boolean;
  onEdit(id: string, patch: Partial<CollectionDraft>): void;
  onChangePrinting(id: string, printing: Printing, finish: Finish): void;
  onDelete(id: string): void;
  onClear(): void;
  onCommit(): void;
  onAddManual(printing: Printing): void;
  onScanMore(): void;
  onMessage(text: string): void;
}) {
  const styles = useStyles();
  const [editing, setEditing] = useState<StagedCard | null>(null);
  const [query, setQuery] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);

  const filtered = query.trim()
    ? staged.filter(s => s.printing.name.toLowerCase().includes(query.trim().toLowerCase()))
    : staged;

  return (
    <ScrollView contentContainerStyle={styles.page}>
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
          index={index}
          onCancel={() => setEditing(null)}
          onSave={patch => { onEdit(editing.id, patch); setEditing(null); }}
          onChangePrinting={(printing, finish) => { onChangePrinting(editing.id, printing, finish); setEditing(null); }}
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
  const styles = useStyles();
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
            subtitle={`${c.printing.setName ?? c.printing.setCode.toUpperCase()} · #${c.printing.collectorNumber} · ${c.printing.language.toUpperCase()} · ${finishSummary(c.printing.finishes)}`}
            // The small picture, not the catalog's normal-size one: up to 50 rows are drawn at once.
            imageUri={thumbnailUri(c.printing.imageUri)}
          />
        </Pressable>
      ))}
      {name.length > 1 && !results.length && <Text style={styles.body}>No match in this catalog. Check the name or spelling.</Text>}
      <Button secondary label="Cancel" onPress={onCancel} />
    </View>
  );
}

function EditSheet({ item, locations, index, onCancel, onSave, onChangePrinting, onMessage }: {
  item: StagedCard; locations: Location[]; index: CardIndex;
  onCancel(): void; onSave(patch: Partial<CollectionDraft>): void;
  onChangePrinting(printing: Printing, finish: Finish): void;
  onMessage(text: string): void;
}) {
  const styles = useStyles();
  const [finish, setFinish] = useState<Finish>(item.draft.finish);
  const [condition, setCondition] = useState<Condition>(item.draft.condition);
  const [language, setLanguage] = useState(item.draft.language);
  const [location, setLocation] = useState<string | null>(item.draft.location_id);
  const [quantity, setQuantity] = useState(String(item.draft.quantity));
  const [changingPrinting, setChangingPrinting] = useState(false);

  function save() {
    const qty = Number(quantity);
    if (!Number.isSafeInteger(qty) || qty < 1) { onMessage('Quantity must be a whole number of at least 1.'); return; }
    onSave({ finish, condition, language, location_id: location, quantity: qty });
  }

  // A printing change is its own confirm, not a field folded into Save: it
  // can force a finish choice the rest of this form knows nothing about, and
  // the two staying separate is what keeps "which card is it" and "how many
  // do I have, in what condition" from being able to disagree mid-edit.
  if (changingPrinting) {
    return (
      <PrintingChangeSheet
        item={item}
        index={index}
        onChoose={onChangePrinting}
        onCancel={() => setChangingPrinting(false)}
      />
    );
  }

  return (
    <View style={styles.sheet}>
      <Text style={styles.section}>{item.printing.name}</Text>
      <Text style={styles.body}>{item.printing.setCode.toUpperCase()} #{item.printing.collectorNumber}</Text>
      <Button secondary label="Change printing…" onPress={() => setChangingPrinting(true)} />
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

/**
 * Change-printing picker for a staged row — the web app's `RowReprint`
 * mirrored for unsaved local state: same search-by-set/collector-number
 * narrowing as `ManualAddSheet`, seeded on this card's name and never left
 * editable (the point is "which printing", not "which card"), and the same
 * `isSameCard` gate the web picker uses so a same-named token or art-series
 * card never turns up as a choice. `reconcileFinish` decides whether the new
 * printing keeps this row's finish, forces a choice, or is flatly impossible
 * (a printing with no recorded finish) — never a silent pick.
 */
function PrintingChangeSheet({ item, index, onChoose, onCancel }: {
  item: StagedCard; index: CardIndex;
  onChoose(printing: Printing, finish: Finish): void;
  onCancel(): void;
}) {
  const styles = useStyles();
  const [setCode, setSetCode] = useState('');
  const [collectorNumber, setCollectorNumber] = useState('');
  const [results, setResults] = useState<Candidate[]>(() => sameCardPrintings(index, item.printing, '', ''));
  const [chosen, setChosen] = useState<Printing | null>(null);
  const [finishChoice, setFinishChoice] = useState<Finish | null>(null);

  function runSearch(sc: string, cn: string) {
    setResults(sameCardPrintings(index, item.printing, sc, cn));
  }

  function pick(printing: Printing) {
    setChosen(printing);
    setFinishChoice(null);
  }

  const reconciliation = chosen ? reconcileFinish(item.draft.finish, chosen.finishes) : null;
  const finish = finishChoice
    ?? (reconciliation?.kind === 'keep' ? reconciliation.finish
      : reconciliation?.kind === 'choose' ? reconciliation.options[0]!
        : null);
  const canConfirm = !!chosen && !!finish && reconciliation?.kind !== 'impossible';

  return (
    <View style={styles.sheet}>
      <Text style={styles.label}>Which printing is it really?</Text>
      <View style={styles.row}>
        <TextInput accessibilityLabel="Set code" style={[styles.input, styles.grow]} placeholder="Set (optional)" autoCapitalize="characters" value={setCode} onChangeText={t => { setSetCode(t); runSearch(t, collectorNumber); }} />
        <TextInput accessibilityLabel="Collector number" style={[styles.input, styles.grow]} placeholder="# (optional)" value={collectorNumber} onChangeText={t => { setCollectorNumber(t); runSearch(setCode, t); }} />
      </View>
      {results.map(c => (
        <Pressable
          key={c.printing.id}
          accessibilityRole="button"
          accessibilityState={{ selected: chosen?.id === c.printing.id }}
          style={[styles.pickerRow, chosen?.id === c.printing.id && styles.pickerRowSelected]}
          onPress={() => pick(c.printing)}
        >
          <ListRow
            title={c.printing.name}
            subtitle={`${c.printing.setName ?? c.printing.setCode.toUpperCase()} · #${c.printing.collectorNumber} · ${finishSummary(c.printing.finishes)}`}
            imageUri={thumbnailUri(c.printing.imageUri)}
          />
        </Pressable>
      ))}
      {!results.length && <Text style={styles.body}>No other printing of this card is in the catalog.</Text>}

      {reconciliation?.kind === 'choose' && (
        <View>
          <Text style={styles.body}>{`This printing was never made in ${reconciliation.from}. Pick the finish you actually have:`}</Text>
          <Choices values={reconciliation.options} selected={finish ?? reconciliation.options[0]} onSelect={v => setFinishChoice(v as Finish)} />
        </View>
      )}
      {reconciliation?.kind === 'impossible' && (
        <Text style={styles.body}>The card database lists no finishes for that printing, so a copy can&apos;t be recorded against it.</Text>
      )}

      <Button label="Confirm" disabled={!canConfirm} onPress={() => chosen && finish && onChoose(chosen, finish)} />
      <Button secondary label="Cancel" onPress={onCancel} />
    </View>
  );
}

/** Every OTHER printing of `current`'s card that the catalog knows, narrowed
 * by set code / collector number the same way `ManualAddSheet` narrows a
 * name search, and gated by `isSameCard` so a same-named token or art-series
 * printing (rare on this catalog, since export-catalog already drops those
 * layouts, but not impossible for a genuine alternate-name reprint) never
 * shows up as a choice. */
function sameCardPrintings(index: CardIndex, current: Printing, setCode: string, collectorNumber: string): Candidate[] {
  const { results } = index.searchWithTotal(current.name, {}, {
    ...(setCode.trim() ? { setCode: setCode.trim() } : {}),
    ...(collectorNumber.trim() ? { collectorNumber: collectorNumber.trim() } : {}),
  });
  return results.filter(c => c.printing.id !== current.id
    && isSameCard({ oracle_id: c.printing.oracleId, name: c.printing.name }, { oracle_id: current.oracleId, name: current.name }));
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  section: { ...typeTokens.title, color: textColor.primary },
  body: { ...typeTokens.body, fontSize: 13, lineHeight: 21, color: textColor.secondary },
  label: { fontSize: 13, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary, marginTop: space.sm },
  // radius.md is the token for inputs; this was `radius.sm + 2`, an
  // arithmetic one-off that happened to land near it. type.input supplies the
  // font family a bare `fontSize: 16` was missing.
  input: { backgroundColor: surface.canvas, borderColor: border.hairline, borderWidth: 1, borderRadius: radius.md, padding: 14, color: textColor.primary, ...typeTokens.input },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  grow: { flex: 1 },
  addButton: { width: 48, height: 48, borderRadius: radius.sm + 2, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { fontSize: 22, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary },
  stagedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowActions: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 15 },
  footer: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheet: { gap: space.sm, backgroundColor: surface.raised, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: border.hairline },
  pickerRow: { borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', padding: 2 },
  pickerRowSelected: { borderColor: border.hairline, backgroundColor: surface.canvas },
}));
