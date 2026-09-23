import React, { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppProvider';
import { PRIVACY_URL, SIGNUP_INVITE_REQUIRED, TERMS_URL, requestPasswordReset, signInWithPassword, signUpWithPassword, type AuthResult } from '../auth';
import { Button, Notice } from '../components/ui';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text as textColor, type as typeTokens } from '../theme';

type Mode = 'signIn' | 'signUp' | 'forgot';

/**
 * Sign in, create account and forgot password on one screen, so the three
 * share one email field and switching between them never loses what was typed.
 * Failures go to the app-wide DismissingNotice (`app.setMessage`); the two
 * outcomes the person has to act on -- "check your email" -- stay on screen as
 * a standing Notice instead of timing out.
 */
export function AuthScreen() {
  const styles = useStyles();
  const app = useApp();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  function switchMode(next: Mode) { setMode(next); setNotice(''); app.setMessage(''); }

  async function submit() {
    if (busy) return;
    setBusy(true); setNotice(''); app.setMessage('');
    let result: AuthResult;
    try {
      result = mode === 'signIn' ? await signInWithPassword(email, password)
        : mode === 'signUp' ? await signUpWithPassword({ email, username, password, confirm, invite })
        : await requestPasswordReset(email);
    } catch {
      result = { ok: false, error: 'Something went wrong. Please try again.' };
    } finally { setBusy(false); }
    if (!result.ok) { app.setMessage(result.error); return; }
    setPassword(''); setConfirm('');
    if (result.notice) setNotice(result.notice);
    // A successful sign-in (or auto-confirmed sign-up) needs nothing here: the
    // auth listener in AppProvider swaps this screen for the app.
  }

  const title = mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create your account' : 'Reset your password';
  const cta = busy ? 'Working…' : mode === 'signIn' ? 'Sign in' : mode === 'signUp' ? 'Create account' : 'Send reset link';
  const emailSent = !!notice && mode !== 'signIn';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>{title}</Text>
        {emailSent ? <Notice>{notice}</Notice> : null}
        {mode === 'forgot' && !emailSent ? (
          <Text style={styles.body}>We will email you a link. You choose the new password on the Upkeep website, then come back here and sign in.</Text>
        ) : null}
        <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={textColor.secondary} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
        {mode === 'signUp' && (
          <TextInput accessibilityLabel="Username" style={styles.input} value={username} onChangeText={setUsername} placeholder="Username (shown to friends)" placeholderTextColor={textColor.secondary} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" />
        )}
        {mode !== 'forgot' && (
          <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={textColor.secondary} secureTextEntry autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} />
        )}
        {mode === 'signUp' && (
          <TextInput accessibilityLabel="Confirm password" style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="Confirm password" placeholderTextColor={textColor.secondary} secureTextEntry autoComplete="new-password" />
        )}
        {mode === 'signUp' && (
          <TextInput accessibilityLabel="Invite code" style={styles.input} value={invite} onChangeText={setInvite} placeholder={SIGNUP_INVITE_REQUIRED ? 'Invite code' : 'Invite code (optional)'} placeholderTextColor={textColor.secondary} autoCapitalize="none" autoCorrect={false} />
        )}
        <Button label={cta} disabled={busy} onPress={() => void submit()} />

        <View style={styles.links}>
          {mode === 'signIn' && <Link label="Forgot your password?" onPress={() => switchMode('forgot')} />}
          {mode === 'signIn' && <Link label="New here? Create an account" onPress={() => switchMode('signUp')} />}
          {mode !== 'signIn' && <Link label="Back to sign in" onPress={() => switchMode('signIn')} />}
        </View>

        <Text style={styles.legal}>
          By continuing you agree to the{' '}
          <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>Terms</Text>
          {' '}and{' '}
          <Text style={styles.legalLink} accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Link({ label, onPress }: { label: string; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: space.xl, gap: space.md },
  section: { ...typeTokens.title, color: textColor.primary },
  body: { ...typeTokens.bodySm, color: textColor.secondary },
  // radius.md for inputs, type.input for the font family a bare
  // `fontSize: 16` was missing -- same fix as Settings/ScanSessionSummary's
  // own inputs (mobile UI brief Priority 4).
  input: { backgroundColor: surface.raised, borderColor: border.hairline, borderWidth: 1, borderRadius: radius.md, padding: 14, color: textColor.primary, ...typeTokens.input },
  links: { gap: space.xs, alignItems: 'center' },
  link: { paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center' },
  linkText: { ...typeTokens.bodySm, color: textColor.secondary, textDecorationLine: 'underline' },
  legal: { ...typeTokens.bodySm, color: textColor.secondary, textAlign: 'center' },
  legalLink: { textDecorationLine: 'underline' },
}));
