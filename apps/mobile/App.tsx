import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import { Cinzel_600SemiBold } from '@expo-google-fonts/cinzel/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { AppProvider, useApp } from './src/AppProvider';
import { backend } from './src/backend';
import { errorMessage } from './src/errors';
import { ScanScreen } from './src/screens/ScanScreen';
import { CollectionScreen } from './src/screens/CollectionScreen';
import { DecksScreen } from './src/screens/DecksScreen';
import { DeckDetailScreen } from './src/screens/DeckDetailScreen';
import { AccountScreen } from './src/screens/AccountScreen';
import { TabBar, ScreenFade } from './src/components/TabBar';
import { Button, Notice } from './src/components/ui';
import type { DecksStackParamList, TabParamList } from './src/navigation';
import { border, space, surface, text as textColor, type as typeTokens } from './src/theme';

/**
 * Thin shell: SafeAreaProvider → fonts → AppProvider → NavigationContainer →
 * root conditional. Everything that used to live in one ~700-line `Scanner`
 * component now lives in AppProvider (state genuinely needed across more
 * than one screen) or in src/screens/** (state local to one screen).
 *
 * React Navigation replaces the old plain `type Tab` state switch — the
 * comment that used to sit on that type said "revisit this when a fourth
 * destination needs its own back stack". Account is that fourth destination
 * (an owner decision, not a feature the switch grew into on its own), and
 * Decks already needed a real back stack once DeckDetail became a route
 * rather than a sub-state — a native-stack screen buys a back gesture the
 * old hand-rolled "‹ Back to decks" button never had. SleevePicker and
 * ReviewCard stay plain in-screen state, not routes: both are safest as
 * something that cannot be swiped away mid-flight (see DeckDetailScreen's
 * and ScanScreen's own comments on this).
 */
export default function App() {
  const [fonts] = useFonts({ Cinzel_600SemiBold, PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold });
  // Scan is the initial tab, and onStateChange does not fire for the initial
  // state, so this starts where the navigator actually starts.
  const [scanFocused, setScanFocused] = useState(true);
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer
          onStateChange={state => setScanFocused(state?.routes[state.index ?? 0]?.name === 'Scan')}
        >
          <RootShell fontsLoaded={fonts} scanFocused={scanFocused} />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const Tab = createBottomTabNavigator<TabParamList>();
const DecksStack = createNativeStackNavigator<DecksStackParamList>();

function DecksNavigator() {
  return (
    <DecksStack.Navigator id="DecksStack" screenOptions={{ headerShown: false }}>
      <DecksStack.Screen name="DeckList" component={DecksScreen} />
      <DecksStack.Screen name="DeckDetail" component={DeckDetailScreen} options={{ headerShown: true, title: 'Deck' }} />
    </DecksStack.Navigator>
  );
}

// Cross-fades each tab's content on focus change (see TabBar.tsx's
// ScreenFade) -- one small wrapper per tab rather than baking the fade into
// every screen component individually.
function ScanTab() { return <ScreenFade><ScanScreen /></ScreenFade>; }
function CollectionTab() { return <ScreenFade><CollectionScreen /></ScreenFade>; }
function DecksTab() { return <ScreenFade><DecksNavigator /></ScreenFade>; }
function AccountTab() { return <ScreenFade><AccountScreen /></ScreenFade>; }

function SignedInTabs() {
  return (
    <Tab.Navigator
      id="RootTabs"
      // The scanner is a full-bleed camera: the bar would sit on top of the
      // live preview and its own result sheet. Its top bar carries a back
      // arrow to Collection instead, the way the original scanner did.
      tabBar={props => props.state.routes[props.state.index]?.name === 'Scan' ? null : <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Scan" component={ScanTab} />
      <Tab.Screen name="Collection" component={CollectionTab} />
      <Tab.Screen name="Decks" component={DecksTab} />
      <Tab.Screen name="Account" component={AccountTab} />
    </Tab.Navigator>
  );
}

/**
 * The app header and the global banner are hidden while the scanner is the
 * focused tab, so the camera runs edge to edge and under the status bar.
 * ScanScreen re-renders `app.message` as an overlay inside itself for exactly
 * that window — a message must never become invisible just because the
 * scanner is open.
 */
function RootShell({ fontsLoaded, scanFocused }: { fontsLoaded: boolean; scanFocused: boolean }) {
  const app = useApp();
  const titleStyle = fontsLoaded ? styles.title : styles.titleFallback;
  const signedIn = app.backendAvailable && !!app.userId;

  // ONE stable tree. Rendering SignedInTabs in two different branches gave it
  // two different tree positions, so React unmounted and remounted the whole
  // navigator on every focus change -- which resets it to its initial route
  // (Scan) and would trap the user on the scanner. Only the chrome toggles;
  // the element holding the navigator never changes position.
  const fullBleed = signedIn && scanFocused;

  return (
    // edges omits 'bottom' deliberately -- the TabBar owns its own bottom
    // inset (see TabBar.tsx), and when it isn't rendered (no session) the
    // ScrollView content itself already pads its bottom edge. Full-bleed
    // takes no insets at all: the scanner draws under the status bar.
    <SafeAreaView style={fullBleed ? styles.fullBleed : styles.safe} edges={fullBleed ? [] : ['top', 'left', 'right']}>
      {!fullBleed && (
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PROJECT UPKEEP</Text>
          <Text style={titleStyle}>Every card has a place.</Text>
        </View>
      )}
      {!fullBleed && (
        <View style={styles.banners}>
          <GlobalBanners />
        </View>
      )}
      <View style={styles.content}>
        {!app.backendAvailable ? (
          <DemoOnly />
        ) : !app.userId ? (
          <SignInForm />
        ) : (
          <SignedInTabs />
        )}
      </View>
    </SafeAreaView>
  );
}

/** No backend configured: today's demo shape, unchanged -- Scan alone, no tabs. */
function DemoOnly() {
  return <ScanScreen />;
}

function SignInForm() {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  async function signIn() {
    if (!backend || authBusy) return;
    setAuthBusy(true); app.setMessage('');
    try {
      const { error } = await backend.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword('');
    } catch (e) { app.setMessage(errorMessage(e)); } finally { setAuthBusy(false); }
  }

  return (
    <View style={styles.account}>
      <Text style={styles.section}>Your Upkeep account</Text>
      <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoComplete="current-password" />
      <Button label={authBusy ? 'Signing in…' : 'Sign in'} disabled={authBusy} onPress={() => void signIn()} />
    </View>
  );
}

/**
 * Pinned above whatever the navigator is currently showing, so a message or
 * a recovered pending move is visible on every tab, not just the one it
 * happened to originate on. No forced navigation on recovery -- surfaced as
 * a tappable banner, per the owner's decision, never an automatic tab
 * switch.
 */
function GlobalBanners() {
  const { message, pendingMove, moveBusy, retryPendingMove } = useApp();
  return (
    <>
      {message ? <Notice>{message}</Notice> : null}
      {pendingMove && (
        <>
          <Notice>An unfinished move needs verifying: {pendingMove.label}.</Notice>
          <Button secondary label={moveBusy ? 'Verifying…' : 'Retry / verify move'} disabled={moveBusy} onPress={() => void retryPendingMove()} />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: surface.canvas },
  fullBleed: { flex: 1, backgroundColor: surface.inverse },
  header: { paddingHorizontal: space.xxl, paddingTop: space.md, gap: 4 },
  eyebrow: { ...typeTokens.eyebrow, color: textColor.secondary },
  title: { fontFamily: 'Cinzel_600SemiBold', fontSize: typeTokens.display.fontSize, lineHeight: typeTokens.display.lineHeight, color: textColor.primary },
  titleFallback: { fontSize: typeTokens.display.fontSize, fontWeight: '600', color: textColor.primary },
  banners: { paddingHorizontal: space.xxl, gap: space.sm },
  content: { flex: 1 },
  section: { ...typeTokens.title, color: textColor.primary },
  account: { padding: space.xxl, gap: space.md },
  input: { backgroundColor: surface.raised, borderColor: border.hairline, borderWidth: 1, borderRadius: 10, padding: 14, color: textColor.primary, fontSize: 16 },
});
