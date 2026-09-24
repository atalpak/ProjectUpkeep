import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { backend } from '../backend';
import { PRIVACY_URL, TERMS_URL, deleteOwnAccount } from '../auth';
import { Button, Choices, Chevron, GroupRow, ListGroup, Tappable, TextField } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { makeStyles, usePreferences, type ThemeMode } from '../preferences';
import { PAGES, PINNABLE, type NavSlots, type PageId } from '../navigation';
import { accent, border, radius, scrim, space, state, surface, text, type as typeTokens } from '../theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const MODE_LABELS: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };
// Spatial names per the UI refinement brief: the preview row already shows
// which page sits where, so these labels are a fallback for screen readers
// and the rare case someone reads them before looking at the icons.
const SLOT_LABELS = ['Left 1', 'Left 2', 'Right 1', 'Right 2'];

export function SettingsScreen() {
  const styles = useStyles();
  const { userId, disabled, signOut, setMessage, syncCatalog, demo, index, checkForCatalogUpdate } = useApp();
  const [updateStatus, setUpdateStatus] = useState('');
  const { mode, setMode, slots, setSlot, resetSlots, setWelcomeSeen } = usePreferences();
  const [email, setEmail] = useState<string | null>(null);
  // Which of the four configurable positions has its picker open, if any.
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  // Deletion is two steps: reveal the warning, then type DELETE. The typed word
  // is a UI guard only; the RPC does its own username check (see auth.ts).
  const [deleting, setDeleting] = useState(false);
  const [deleteWord, setDeleteWord] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function confirmDelete() {
    if (!userId || deleteBusy || deleteWord !== 'DELETE') return;
    setDeleteBusy(true);
    try {
      const result = await deleteOwnAccount(userId);
      if (!result.ok) setMessage(result.error);
      else setMessage('Your account has been deleted.');
    } catch { setMessage('Something went wrong. Your account was not deleted.'); }
    finally { setDeleteBusy(false); setDeleteWord(''); setDeleting(false); }
  }

  useEffect(() => {
    let alive = true;
    if (!backend || !userId) return;
    void backend.auth.getUser().then(({ data }) => { if (alive) setEmail(data.user?.email ?? null); }, () => {});
    return () => { alive = false; };
  }, [userId]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PageTitle>{PAGES.Settings.title}</PageTitle>
      <Text style={styles.heading}>Appearance</Text>
      <Choices values={MODES} selected={mode} labels={MODE_LABELS} onSelect={v => setMode(v as ThemeMode)} />

      <Text style={styles.heading}>Navigation bar</Text>
      <View style={styles.card}>
        <Text style={styles.body}>Scan always stays in the middle. Tap a spot to change it; everything else is in the menu.</Text>
        <NavSlotPreview slots={slots} onPick={i => setPickerSlot(i)} />
        <Button secondary label="Reset to default" onPress={resetSlots} />
      </View>
      <SlotPicker
        slotIndex={pickerSlot}
        slots={slots}
        onSelect={page => { if (pickerSlot !== null) setSlot(pickerSlot, page); setPickerSlot(null); }}
        onClose={() => setPickerSlot(null)}
      />

      <Text style={styles.heading}>Welcome</Text>
      <Text style={styles.body}>A quick tour of what Upkeep does.</Text>
      <Button secondary label="Show the welcome again" onPress={() => setWelcomeSeen(false)} />

      <Text style={styles.heading}>Account</Text>
      <ListGroup>
        <GroupRow><Text style={styles.rowText}>{userId ? (email ? `Signed in as ${email}` : 'Connected to Upkeep') : 'Not signed in'}</Text></GroupRow>
        <GroupRow accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}><Text style={styles.rowText}>Terms of Service</Text><Chevron /></GroupRow>
        <GroupRow accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}><Text style={styles.rowText}>Privacy Policy</Text><Chevron /></GroupRow>
      </ListGroup>
      <Button label="Sign out" secondary disabled={disabled || !userId} onPress={() => void signOut()} />

      {!!userId && (
        <>
          <Text style={styles.heading}>Delete account</Text>
          <View style={styles.card}>
            <Text style={styles.body}>Permanently deletes your account, collection, locations, decks, wish list and friendships. Trades you completed stay in the other person’s history. This cannot be undone. The card database and settings on this phone are kept.</Text>
            {!deleting ? (
              <Button secondary label="Delete my account…" disabled={disabled} onPress={() => setDeleting(true)} />
            ) : (
              <>
                <Text style={styles.danger}>Type DELETE to confirm.</Text>
                <TextField tone="canvas" accessibilityLabel="Type DELETE to confirm" value={deleteWord} onChangeText={setDeleteWord} placeholder="DELETE" autoCapitalize="characters" autoCorrect={false} />
                <Button label={deleteBusy ? 'Deleting…' : 'Permanently delete account'} loading={deleteBusy} disabled={deleteWord !== 'DELETE'} onPress={() => void confirmDelete()} />
                <Button secondary label="Cancel" disabled={deleteBusy} onPress={() => { setDeleting(false); setDeleteWord(''); }} />
              </>
            )}
          </View>
        </>
      )}

      <Text style={styles.heading}>Card database</Text>
      <Text style={styles.body}>
        {demo
          ? 'No card database on this phone yet. The scanner needs it to recognize cards.'
          : `The scanner matches cards against a copy stored on this phone. Yours is from ${new Date(index.bundle.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`}
      </Text>
      {demo
        ? <Button label="Download card database" disabled={disabled} onPress={() => void syncCatalog()} />
        : <Button secondary label="Check for updates" disabled={disabled} onPress={() => {
          setUpdateStatus('Checking…');
          void checkForCatalogUpdate(true).then(r => setUpdateStatus(r.status === 'current' ? 'You’re up to date.' : r.status === 'available' ? '' : 'Couldn’t check just now. Try again later.'));
        }} />}
      {!!updateStatus && <Text style={styles.body}>{updateStatus}</Text>}
    </ScrollView>
  );
}

/**
 * The five bar positions in one glance: two configurable spots, Scan fixed in
 * the middle, two more configurable spots. Replaces the old layout of four
 * full `Choices` rows (one per slot, each listing all ~9 pinnable pages) that
 * repeated the whole destination list four times on one screen. Tapping a
 * configurable spot opens `SlotPicker`; Scan itself is not tappable here —
 * its position isn't a setting.
 */
function NavSlotPreview({ slots, onPick }: { slots: NavSlots; onPick(index: number): void }) {
  const styles = useStyles();
  return (
    <View style={styles.preview}>
      {slots.slice(0, 2).map((page, i) => <SlotChip key={SLOT_LABELS[i]} label={SLOT_LABELS[i]} page={page} onPress={() => onPick(i)} />)}
      <View style={[styles.chip, styles.chipFixed]}>
        <Ionicons name={PAGES.Scan.filled} size={20} color={text.onAccent} />
        <Text style={styles.chipLabelFixed} numberOfLines={1}>Scan</Text>
      </View>
      {slots.slice(2, 4).map((page, i) => <SlotChip key={SLOT_LABELS[i + 2]} label={SLOT_LABELS[i + 2]} page={page} onPress={() => onPick(i + 2)} />)}
    </View>
  );
}

function SlotChip({ label, page, onPress }: { label: string; page: PageId; onPress(): void }) {
  const styles = useStyles();
  const info = PAGES[page];
  return (
    <Tappable feedback="dim" accessibilityRole="button" accessibilityLabel={`${label}: ${info.title}. Tap to change.`} style={styles.chip} onPress={onPress}>
      <Ionicons name={info.outline} size={20} color={text.primary} />
      <Text style={styles.chipLabel} numberOfLines={1}>{info.short ?? info.title}</Text>
    </Tappable>
  );
}

/**
 * The concise picker the brief asks for: one list of the pinnable pages,
 * opened for a single slot at a time instead of four inline lists shown at
 * once. `setSlot` (preferences.tsx) already swaps the two slots when the
 * chosen page sits elsewhere in the bar — the simpler of the brief's two
 * options ("prevent" vs. "explain") for handling a duplicate — so the picker
 * just names the swap plainly rather than blocking the choice.
 */
function SlotPicker({ slotIndex, slots, onSelect, onClose }: {
  slotIndex: number | null; slots: NavSlots; onSelect(page: PageId): void; onClose(): void;
}) {
  const styles = useStyles();
  if (slotIndex === null) return null;
  const current = slots[slotIndex];
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.pickerScrim} accessibilityLabel="Close" onPress={onClose}>
        <Pressable style={styles.pickerCard} onPress={() => {}}>
          <Text style={styles.pickerTitle}>{SLOT_LABELS[slotIndex]}</Text>
          <ScrollView>
            {PINNABLE.map(page => {
              const info = PAGES[page];
              const selected = page === current;
              const otherSlot = slots.findIndex((p, i) => p === page && i !== slotIndex);
              return (
                <Tappable
                  key={page}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                  onPress={() => onSelect(page)}
                >
                  <Ionicons name={selected ? info.filled : info.outline} size={20} color={text.primary} />
                  <Text style={styles.pickerRowLabel}>{info.title}</Text>
                  {otherSlot >= 0 && !selected && <Text style={styles.pickerSwapNote}>swaps with {SLOT_LABELS[otherSlot]}</Text>}
                  {selected && <Ionicons name="checkmark" size={18} color={accent.DEFAULT} />}
                </Tappable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  // 20pt (space.xl) is the app's one shared horizontal page inset (mobile UI
  // brief Priority 4) -- this screen used to be the wider space.xxl (24pt),
  // out of step with Dashboard/Collection/Decks/DeckDetail's xl.
  page: { padding: space.xl, paddingBottom: 40, gap: space.md },
  heading: { ...typeTokens.title, color: text.primary, marginTop: space.md },
  body: { ...typeTokens.bodySm, color: text.secondary },
  // radius.lg (16) is the token for cards/grouped panels -- this used to spell
  // the same value out as a literal `16`.
  card: { padding: space.lg, backgroundColor: surface.raised, borderRadius: radius.lg, gap: space.md, borderWidth: 1, borderColor: border.hairline },
  rowText: { flex: 1, ...typeTokens.body, color: text.primary },
  danger: { ...typeTokens.label, color: state.error },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chip: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.canvas },
  chipFixed: { backgroundColor: accent.DEFAULT, borderColor: accent.DEFAULT },
  chipLabel: { ...typeTokens.label, color: text.secondary, textTransform: 'none' },
  chipLabelFixed: { ...typeTokens.label, color: text.onAccent, textTransform: 'none' },
  pickerScrim: { flex: 1, backgroundColor: scrim, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  pickerCard: { width: '100%', maxHeight: '70%', backgroundColor: surface.raised, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  pickerTitle: { ...typeTokens.title, color: text.primary, marginBottom: space.xs },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.md },
  pickerRowSelected: { backgroundColor: accent.soft },
  pickerRowLabel: { flex: 1, ...typeTokens.body, color: text.primary },
  pickerSwapNote: { ...typeTokens.label, color: text.secondary, textTransform: 'none' },
}));
