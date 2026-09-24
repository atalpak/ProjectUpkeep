import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Choices, Notice, Tappable } from './ui';
import { DECK_ARCHETYPES, DECK_FORMATS, DECK_FORMAT_MAX, DECK_NAME_MAX, DECK_NOTES_MAX, DECK_TAG_MAX, DECK_TAGS_MAX, normalizeTags, type DeckDetailsInput } from '../decks';
import { errorMessage } from '../errors';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type as typeTokens } from '../theme';

const FORMAT_LABELS: Record<string, string> = Object.fromEntries(DECK_FORMATS.map(f => [f, f]));

/**
 * The deck's name, format, archetype tags and notes: the same four fields the
 * web's details editor saves, in one write. Format and tags are free text with
 * suggestion chips, because on the web the lists are suggestions, not a
 * whitelist.
 */
export function DeckDetailsEditor({ initial, onSave, onCancel }: {
  initial: DeckDetailsInput;
  onSave(input: DeckDetailsInput): Promise<void>;
  onCancel(): void;
}) {
  const styles = useStyles();
  const [name, setName] = useState(initial.name);
  const [format, setFormat] = useState(initial.format);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function addTag(raw: string) {
    setTags(prev => normalizeTags([...prev, raw]));
    setTagDraft('');
  }

  async function save() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // A tag typed but not yet added still counts, as anyone would expect.
      await onSave({ name, format, tags: normalizeTags([...tags, tagDraft]), notes });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Name</Text>
      <TextInput accessibilityLabel="Deck name" style={styles.input} value={name} onChangeText={setName} maxLength={DECK_NAME_MAX} editable={!busy} />

      <Text style={styles.label}>Format</Text>
      <TextInput accessibilityLabel="Format" style={styles.input} value={format} onChangeText={setFormat} maxLength={DECK_FORMAT_MAX} placeholder="Commander, Modern, …" placeholderTextColor={text.secondary} editable={!busy} />
      <Choices values={[...DECK_FORMATS]} labels={FORMAT_LABELS} selected={DECK_FORMATS.find(f => f.toLowerCase() === format.trim().toLowerCase())} disabled={busy} onSelect={setFormat} />

      <Text style={styles.label}>Archetype tags</Text>
      {tags.length > 0 && (
        <View style={styles.chips}>
          {tags.map(t => (
            <Tappable feedback="dim" key={t} accessibilityRole="button" accessibilityLabel={`Remove ${t}`} disabled={busy} onPress={() => setTags(prev => prev.filter(x => x !== t))} style={styles.tag}>
              <Text style={styles.tagText}>{t}  ×</Text>
            </Tappable>
          ))}
        </View>
      )}
      <View style={styles.addRow}>
        <TextInput accessibilityLabel="Add a tag" style={[styles.input, styles.grow]} value={tagDraft} onChangeText={setTagDraft} maxLength={DECK_TAG_MAX} placeholder="Add a tag" placeholderTextColor={text.secondary} editable={!busy} returnKeyType="done" onSubmitEditing={() => addTag(tagDraft)} />
        <Button secondary label="Add" disabled={busy || !tagDraft.trim() || tags.length >= DECK_TAGS_MAX} onPress={() => addTag(tagDraft)} />
      </View>
      <View style={styles.chips}>
        {DECK_ARCHETYPES.filter(a => !tags.some(t => t.toLowerCase() === a.toLowerCase())).map(a => (
          <Tappable feedback="dim" key={a} accessibilityRole="button" accessibilityLabel={`Add tag ${a}`} disabled={busy || tags.length >= DECK_TAGS_MAX} onPress={() => addTag(a)} style={styles.suggest}>
            <Text style={styles.suggestText}>{a}</Text>
          </Tappable>
        ))}
      </View>

      <Text style={styles.label}>Notes</Text>
      <TextInput accessibilityLabel="Notes" style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} maxLength={DECK_NOTES_MAX} multiline textAlignVertical="top" placeholder="Game plan, swaps to try, sideboard notes…" placeholderTextColor={text.secondary} editable={!busy} />

      {!!error && <Notice>{error}</Notice>}
      <Button label={busy ? 'Saving…' : 'Save details'} disabled={busy || !name.trim()} onPress={() => void save()} />
      <Button secondary label="Cancel" disabled={busy} onPress={onCancel} />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  form: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  label: { ...typeTokens.label, color: text.secondary, marginTop: space.xs },
  input: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas, color: text.primary, ...typeTokens.body },
  notes: { minHeight: 110, paddingTop: space.sm },
  grow: { flex: 1 },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: border.strong, backgroundColor: surface.canvas },
  tagText: { ...typeTokens.label, color: text.primary },
  suggest: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: border.hairline },
  suggestText: { ...typeTokens.label, color: text.secondary },
}));
