import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Switch, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { changePassword, requestPasswordReset } from '../auth';
import { DEFAULT_NOTIFICATION_PREFERENCES, loadNotificationPreferences, saveNotificationPreference, type NotificationPreferences } from '../notificationPreferences';
import { makeStyles } from '../preferences';
import { border, radius, space, state, surface, text, type } from '../theme';
import { Button, TextField } from './ui';

export function PasswordSettings({ userId, email }: { userId: string; email: string | null }) {
  const styles = useStyles();
  const focused = useIsFocused();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const saving = useRef(false);
  const mounted = useRef(true);
  function clear() { setCurrent(''); setPassword(''); setConfirm(''); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!focused) { clear(); setOpen(false); setStatus(''); }
    const sub = AppState.addEventListener('change', next => { if (next !== 'active') { clear(); setOpen(false); } });
    return () => sub.remove();
  }, [focused]);
  async function save(reset = false) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setStatus('');
    try {
      const result = reset ? await requestPasswordReset(email ?? '') : await changePassword(userId, { current, password, confirm });
      if (!mounted.current) return;
      setStatus(result.ok ? result.notice ?? 'Saved.' : result.error);
      if (result.ok || reset) { clear(); setOpen(false); }
    } catch { if (mounted.current) setStatus('Could not reach Upkeep. Check your connection and try again.'); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Password</Text>
      {!open ? <Button secondary label="Change password" disabled={busy} onPress={() => { setStatus(''); setOpen(true); }} /> : <>
        <TextField accessibilityLabel="Current password" placeholder="Current password" secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" value={current} onChangeText={setCurrent} editable={!busy} />
        <TextField accessibilityLabel="New password" placeholder="New password" secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" value={password} onChangeText={setPassword} editable={!busy} />
        <TextField accessibilityLabel="Confirm new password" placeholder="Confirm new password" secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" value={confirm} onChangeText={setConfirm} editable={!busy} />
        <Button label="Save password" loading={busy} onPress={() => void save()} />
        <Button secondary label="Cancel" disabled={busy} onPress={() => { clear(); setOpen(false); setStatus(''); }} />
      </>}
      <Button secondary label="Send password reset email" disabled={busy || !email} onPress={() => void save(true)} />
      {!!status && <Text accessibilityLiveRegion="polite" style={styles.body}>{status}</Text>}
    </View>
  );
}

const CATEGORIES: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: 'trade_offers', label: 'Trade offers', description: 'New proposals and counteroffers.' },
  { key: 'trade_updates', label: 'Trade updates', description: 'Accepted, declined and cancelled trades.' },
  { key: 'friendships', label: 'Friend activity', description: 'Friend requests and accepted requests.' },
];
export function NotificationSettings({ userId }: { userId: string }) {
  const styles = useStyles();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    void loadNotificationPreferences(userId).then(value => { if (alive) setPrefs(value); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, reload]);
  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    if (loading || error || inFlight.current) return;
    inFlight.current = true; setSaving(true);
    const previous = prefs; setPrefs({ ...prefs, [key]: value });
    try { await saveNotificationPreference(userId, key, value); }
    catch (e) { if (mounted.current) { setPrefs(previous); setError(e instanceof Error ? e.message : 'Could not save your preference.'); } }
    finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>In-app alerts</Text>
      <Text style={styles.body}>Applies to new alerts on your account. Existing alerts stay in your inbox. These settings do not enable phone push notifications.</Text>
      {CATEGORIES.map(category => <View key={category.key} style={styles.row}>
        <View style={styles.label}><Text style={styles.title}>{category.label}</Text><Text style={styles.body}>{category.description}</Text></View>
        <Switch accessibilityLabel={category.label} value={prefs[category.key]} disabled={loading || saving || !!error} onValueChange={value => void toggle(category.key, value)} />
      </View>)}
      {loading && <Text style={styles.body}>Loading preferences…</Text>}
      {saving && <Text accessibilityLiveRegion="polite" style={styles.body}>Saving…</Text>}
      {!!error && <><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text><Button secondary label="Retry loading preferences" disabled={saving} onPress={() => setReload(n => n + 1)} /></>}
    </View>
  );
}
const useStyles = makeStyles(() => StyleSheet.create({
  card: { padding: space.lg, gap: space.md, backgroundColor: surface.canvas, borderWidth: 1, borderColor: border.hairline, borderRadius: radius.lg },
  title: { ...type.body, fontWeight: '600', color: text.primary },
  body: { ...type.bodySm, color: text.secondary },
  error: { ...type.bodySm, color: state.error },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  label: { flex: 1, gap: space.xs },
}));
