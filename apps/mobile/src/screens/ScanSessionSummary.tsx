import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONDITIONS, LANGUAGES, finishSummary, thumbnailUri, type CardIndex, type Candidate, type CollectionDraft, type Condition, type Finish, type Printing } from '@upkeep/scan-core';
import { isSameCard, reconcileFinish } from '@upkeep/domain';
import { Button, Choices, Tappable, TextField } from '../components/ui';
import { ListRow } from '../components/ListRow';
import type { StagedCard } from './ScanScreen';
import { accent, border, duration, fontFamily, radius, space, surface, text as textColor, type as typeTokens } from '../theme';
import { makeStyles } from '../preferences';
import { useReducedMotion } from '../hooks/useReducedMotion';

type Location = { id: string; name: string };

export function ScanSessionSummary({
  visible, bottom, staged, locations, index, committing, priceForRow, onEdit, onChangePrinting, onDelete, onClear, onCommit, onAddManual, onScanMore, onMessage,
}: {
  visible: boolean;
  bottom: number;
  staged: StagedCard[];
  locations: Location[];
  index: CardIndex;
  committing: boolean;
  priceForRow(item: StagedCard): number | null;
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [editing, setEditing] = useState<StagedCard | null>(null);
  const [query, setQuery] = useState('');
  const [addingOpen, setAddingOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: reducedMotion ? 0 : duration.quick, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: reducedMotion ? 0 : duration.micro, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) { setMounted(false); setEditing(null); setAddingOpen(false); setQuery(''); } });
    }
    return () => progress.stopAnimation();
  }, [visible, reducedMotion, progress]);

  if (!mounted) return null;

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? staged.filter(s => `${s.printing.name} ${s.printing.setName ?? ''} ${s.printing.setCode} ${s.printing.collectorNumber}`.toLowerCase().includes(needle))
    : staged;
  const count = staged.reduce((sum, item) => sum + item.draft.quantity, 0);
  const subview = addingOpen || editing;
  const closeSubview = () => { setAddingOpen(false); setEditing(null); };

  return (
    <View style={[styles.overlay, { top: insets.top + space.xl, bottom }]}>
      <Animated.View style={[styles.overlayShade, { opacity: progress }]} pointerEvents="none" />
      <Animated.View style={[styles.panel, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }]}>
        <View style={styles.grabber} />
        <View style={styles.panelHeader}>
          <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel={subview ? 'Back to scan list' : 'Close scan list'} style={styles.headerAction} onPress={subview ? closeSubview : onScanMore}>
            <Ionicons name={subview ? 'arrow-back' : 'chevron-down'} size={24} color={textColor.primary} />
          </Tappable>
          <Text style={styles.panelTitle}>{addingOpen ? 'Add a card' : editing ? 'Edit scanned card' : `${count} card${count === 1 ? '' : 's'} scanned`}</Text>
          <View style={styles.headerAction} />
        </View>
        {subview ? (
          <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            {addingOpen && <ManualAddSheet index={index} onAdd={printing => { onAddManual(printing); setAddingOpen(false); }} onCancel={closeSubview} />}
            {editing && <EditSheet item={editing} locations={locations} index={index} onCancel={closeSubview} onSave={patch => { onEdit(editing.id, patch); setEditing(null); }} onChangePrinting={(printing, finish) => { onChangePrinting(editing.id, printing, finish); setEditing(null); }} onMessage={onMessage} />}
          </ScrollView>
        ) : (
          <>
            <View style={styles.searchRow}>
              <View style={styles.searchField}>
                <Ionicons name="search-outline" size={21} color={textColor.secondary} />
                <TextInput accessibilityLabel="Search scanned cards" placeholder="Search cards" placeholderTextColor={textColor.secondary} style={styles.searchInput} value={query} onChangeText={setQuery} autoCorrect={false} />
                {!!query && <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')}><Ionicons name="close-circle" size={19} color={textColor.secondary} /></Tappable>}
              </View>
              <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel="Add a card by name" disabled={committing} style={styles.addButton} onPress={() => setAddingOpen(true)}>
                <Ionicons name="add" size={28} color={textColor.primary} />
              </Tappable>
            </View>
            <FlatList
              data={filtered}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={<Text style={styles.emptyText}>{staged.length ? 'No scanned cards match your search.' : 'No cards scanned yet. Add one by name or return to the camera.'}</Text>}
              renderItem={({ item }) => (
                <View style={styles.stagedRow}>
                  <Tappable feedback="dim" style={styles.cardMain} disabled={committing} onPress={() => setEditing(item)}>
                    <Image source={item.printing.imageUri ? { uri: thumbnailUri(item.printing.imageUri) ?? item.printing.imageUri } : undefined} style={styles.cardImage} resizeMode="cover" />
                    <View style={styles.cardInfo}>
                      <Text numberOfLines={2} style={styles.cardName}>{item.draft.quantity}× {item.printing.name}</Text>
                      <Text numberOfLines={2} style={styles.cardSet}>{item.printing.setName ?? item.printing.setCode.toUpperCase()} · {item.printing.setCode.toUpperCase()} #{item.printing.collectorNumber}</Text>
                      <Text numberOfLines={1} style={styles.cardMeta}>{item.draft.language.toUpperCase()} · {item.draft.condition} · {item.draft.finish}{item.band === 'uncertain' ? ' · Verify printing' : ''}</Text>
                      <Text style={styles.cardPrice}>{priceForRow(item) == null ? 'Price unavailable' : `Est. $${((priceForRow(item) ?? 0) * item.draft.quantity).toFixed(2)}`}</Text>
                    </View>
                  </Tappable>
                  <View style={styles.rowActions}>
                    <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel={`Edit ${item.printing.name}`} disabled={committing} style={styles.iconButton} onPress={() => setEditing(item)}><Ionicons name="create-outline" size={22} color={textColor.primary} /></Tappable>
                    <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel={`Remove ${item.printing.name}`} disabled={committing} style={styles.iconButton} onPress={() => onDelete(item.id)}><Ionicons name="trash-outline" size={21} color={textColor.secondary} /></Tappable>
                  </View>
                </View>
              )}
            />
            <View style={styles.footer}>
              <View style={styles.grow}><Button secondary label="Clear" disabled={!staged.length || committing} onPress={onClear} /></View>
              <View style={styles.grow}><Button label={committing ? 'Adding…' : `Add to collection (${count})`} disabled={!staged.length || committing} onPress={onCommit} /></View>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
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
      <TextField tone="canvas"
        accessibilityLabel="Card name"
       
        placeholder="Enter the full card name"
        value={name}
        onChangeText={t => { setName(t); runSearch(t, setCode, collectorNumber); }}
      />
      <View style={styles.row}>
        <TextField tone="canvas" accessibilityLabel="Set code" style={styles.grow} placeholder="Set (optional)" autoCapitalize="characters" value={setCode} onChangeText={t => { setSetCode(t); runSearch(name, t, collectorNumber); }} />
        <TextField tone="canvas" accessibilityLabel="Collector number" style={styles.grow} placeholder="# (optional)" value={collectorNumber} onChangeText={t => { setCollectorNumber(t); runSearch(name, setCode, t); }} />
      </View>
      {total > results.length && <Text style={styles.body}>Showing {results.length} of {total} matched — narrow with a set code or collector number.</Text>}
      {results.map(c => (
        <Tappable feedback="dim" key={c.printing.id} onPress={() => onAdd(c.printing)}>
          <ListRow
            title={c.printing.name}
            subtitle={`${c.printing.setName ?? c.printing.setCode.toUpperCase()} · #${c.printing.collectorNumber} · ${c.printing.language.toUpperCase()} · ${finishSummary(c.printing.finishes)}`}
            // The small picture, not the catalog's normal-size one: up to 50 rows are drawn at once.
            imageUri={thumbnailUri(c.printing.imageUri)}
          />
        </Tappable>
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
      <TextField tone="canvas" accessibilityLabel="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
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
        <TextField tone="canvas" accessibilityLabel="Set code" style={styles.grow} placeholder="Set (optional)" autoCapitalize="characters" value={setCode} onChangeText={t => { setSetCode(t); runSearch(t, collectorNumber); }} />
        <TextField tone="canvas" accessibilityLabel="Collector number" style={styles.grow} placeholder="# (optional)" value={collectorNumber} onChangeText={t => { setCollectorNumber(t); runSearch(setCode, t); }} />
      </View>
      {results.map(c => (
        <Tappable feedback="dim"
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
        </Tappable>
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
  overlay: { position: 'absolute', left: 0, right: 0, zIndex: 30 },
  overlayShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  panel: { flex: 1, backgroundColor: surface.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginTop: space.sm, backgroundColor: border.strong },
  panelHeader: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md },
  panelTitle: { ...typeTokens.title, color: textColor.primary, textAlign: 'center', flex: 1 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.md, paddingBottom: space.md },
  searchField: { flex: 1, height: 46, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  searchInput: { flex: 1, minWidth: 0, height: '100%', color: textColor.primary, fontFamily: fontFamily.body, fontSize: 16 },
  listContent: { paddingHorizontal: space.md, paddingBottom: space.lg, flexGrow: 1 },
  emptyText: { ...typeTokens.body, color: textColor.secondary, textAlign: 'center', paddingTop: space.xl },
  stagedRow: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: border.hairline, gap: space.xs },
  cardMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardImage: { width: 57, height: 80, borderRadius: radius.thumb, backgroundColor: surface.raised },
  cardInfo: { flex: 1, minWidth: 0, gap: 3 },
  cardName: { ...typeTokens.rowTitle, color: textColor.primary },
  cardSet: { ...typeTokens.bodySm, color: textColor.secondary },
  cardMeta: { ...typeTokens.caption, color: textColor.secondary, textTransform: 'capitalize' },
  cardPrice: { ...typeTokens.caption, color: accent.DEFAULT },
  rowActions: { justifyContent: 'space-between', alignItems: 'center', width: 40 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: border.hairline, backgroundColor: surface.canvas },
  formContent: { paddingHorizontal: space.md, paddingBottom: space.xl, gap: space.md },
  section: { ...typeTokens.title, color: textColor.primary },
  body: { ...typeTokens.bodySm, color: textColor.secondary },
  label: { ...typeTokens.fieldLabel, color: textColor.primary, marginTop: space.sm },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  grow: { flex: 1 },
  addButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheet: { gap: space.sm, backgroundColor: surface.raised, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: border.hairline },
  pickerRow: { borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', padding: 2 },
  pickerRowSelected: { borderColor: border.hairline, backgroundColor: surface.canvas },
}));
