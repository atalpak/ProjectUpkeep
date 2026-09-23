import React, { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppProvider';
import { backend } from '../backend';
import { PRIVACY_URL, TERMS_URL, deleteOwnAccount } from '../auth';
import { Button, Choices } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { makeStyles, usePreferences, type ThemeMode } from '../preferences';
import { PAGES, PINNABLE, type PageId } from '../navigation';
import { border, space, state, surface, text, type as typeTokens } from '../theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const MODE_LABELS: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const SLOT_LABELS = ['First tab', 'Second tab', 'Fourth tab', 'Fifth tab'];
const PAGE_LABELS = Object.fromEntries(PINNABLE.map(id => [id, PAGES[id].title]));

export function SettingsScreen() {
  const styles = useStyles();
  const { userId, disabled, signOut, setMessage, syncCatalog, demo, index, checkForCatalogUpdate } = useApp();
  const [updateStatus, setUpdateStatus] = useState('');
  const { mode, setMode, slots, setSlot, resetSlots, setWelcomeSeen } = usePreferences();
  const [email, setEmail] = useState<string | null>(null);
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
      <View style={styles.card}>
        <Choices values={MODES} selected={mode} labels={MODE_LABELS} onSelect={v => setMode(v as ThemeMode)} />
      </View>

      <Text style={styles.heading}>Navigation bar</Text>
      <View style={styles.card}>
        <Text style={styles.body}>Scan always stays in the middle. Pick the pages for the other four spots; everything else is in the menu.</Text>
        {slots.map((page, i) => (
          <View key={SLOT_LABELS[i]} style={styles.slot}>
            <Text style={styles.slotLabel}>{SLOT_LABELS[i]}</Text>
            <Choices values={PINNABLE} selected={page} labels={PAGE_LABELS} onSelect={v => setSlot(i, v as PageId)} />
          </View>
        ))}
        <Button secondary label="Reset to default" onPress={resetSlots} />
      </View>

      <Text style={styles.heading}>Welcome</Text>
      <View style={styles.card}>
        <Text style={styles.body}>A quick tour of what Upkeep does.</Text>
        <Button secondary label="Show the welcome again" onPress={() => setWelcomeSeen(false)} />
      </View>

      <Text style={styles.heading}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{userId ? (email ? `Signed in as ${email}` : 'Connected to Upkeep') : 'Not signed in'}</Text>
        <Button label="Sign out" secondary disabled={disabled || !userId} onPress={() => void signOut()} />
        <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>Terms of Service</Text>
        <Text style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
      </View>

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
                <TextInput accessibilityLabel="Type DELETE to confirm" style={styles.input} value={deleteWord} onChangeText={setDeleteWord} placeholder="DELETE" placeholderTextColor={text.secondary} autoCapitalize="characters" autoCorrect={false} />
                <Button label={deleteBusy ? 'Deleting…' : 'Permanently delete account'} disabled={deleteBusy || deleteWord !== 'DELETE'} onPress={() => void confirmDelete()} />
                <Button secondary label="Cancel" disabled={deleteBusy} onPress={() => { setDeleting(false); setDeleteWord(''); }} />
              </>
            )}
          </View>
        </>
      )}

      <Text style={styles.heading}>Card database</Text>
      <View style={styles.card}>
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
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  heading: { ...typeTokens.title, color: text.primary, marginTop: space.md },
  body: { ...typeTokens.bodySm, color: text.secondary },
  card: { padding: space.lg, backgroundColor: surface.raised, borderRadius: 16, gap: space.md, borderWidth: 1, borderColor: border.hairline },
  link: { ...typeTokens.bodySm, color: text.secondary, textDecorationLine: 'underline', paddingVertical: space.xs },
  danger: { ...typeTokens.label, color: state.error },
  input: { backgroundColor: surface.raised, borderColor: border.hairline, borderWidth: 1, borderRadius: 10, padding: 14, color: text.primary, fontSize: 16 },
  slot: { gap: space.sm },
  slotLabel: { ...typeTokens.label, color: text.secondary },
}));
