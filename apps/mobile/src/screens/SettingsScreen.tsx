import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { backend } from '../backend';
import { Button, Choices } from '../components/ui';
import { makeStyles, usePreferences, type ThemeMode } from '../preferences';
import { PAGES, PINNABLE, type PageId } from '../navigation';
import { border, space, surface, text, type as typeTokens } from '../theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const MODE_LABELS: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const SLOT_LABELS = ['First tab', 'Second tab', 'Fourth tab', 'Fifth tab'];
const PAGE_LABELS = Object.fromEntries(PINNABLE.map(id => [id, PAGES[id].title]));

export function SettingsScreen() {
  const styles = useStyles();
  const { userId, disabled, signOut, syncCatalog, demo, index, checkForCatalogUpdate } = useApp();
  const [updateStatus, setUpdateStatus] = useState('');
  const { mode, setMode, slots, setSlot, resetSlots } = usePreferences();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!backend || !userId) return;
    void backend.auth.getUser().then(({ data }) => { if (alive) setEmail(data.user?.email ?? null); }, () => {});
    return () => { alive = false; };
  }, [userId]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
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

      <Text style={styles.heading}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{userId ? (email ? `Signed in as ${email}` : 'Connected to Upkeep') : 'Not signed in'}</Text>
        <Button label="Sign out" secondary disabled={disabled || !userId} onPress={() => void signOut()} />
      </View>

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
  slot: { gap: space.sm },
  slotLabel: { ...typeTokens.label, color: text.secondary },
}));
