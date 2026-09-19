import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { DefaultTheme, NavigationContainer, createNavigationContainerRef, type NavigationState, type PartialState } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import { Cinzel_600SemiBold } from '@expo-google-fonts/cinzel/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { AppProvider, useApp } from './src/AppProvider';
import { ScanScreen } from './src/screens/ScanScreen';
import { CollectionScreen } from './src/screens/CollectionScreen';
import { DecksScreen } from './src/screens/DecksScreen';
import { DeckDetailScreen } from './src/screens/DeckDetailScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { LocationsScreen } from './src/screens/LocationsScreen';
import { LocationDetailScreen } from './src/screens/LocationDetailScreen';
import { FriendsScreen } from './src/screens/FriendsScreen';
import { FriendProfileScreen } from './src/screens/FriendProfileScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { WishlistScreen } from './src/screens/WishlistScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';
import { TradesScreen } from './src/screens/TradesScreen';
import { TradeDetailScreen } from './src/screens/TradeDetailScreen';
import { TradeBuilderScreen } from './src/screens/TradeBuilderScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { useUnreadCount } from './src/hooks/useUnreadCount';
import { AppHeader } from './src/components/AppHeader';
import { MenuSheet } from './src/components/MenuSheet';
import { SearchOverlay } from './src/components/SearchOverlay';
import { CatalogDownloadModal } from './src/components/CatalogDownloadModal';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { WelcomeWalkthrough } from './src/components/WelcomeWalkthrough';
import { CardDetails } from './src/components/CardDetails';
import { CardDetailsContext, type CardDetailsTarget } from './src/cardDetailsHost';
import { SearchOverlayContext } from './src/searchOverlay';
import { PreferencesProvider, usePreferences } from './src/preferences';
import { TabBar, ScreenFade } from './src/components/TabBar';
import { Button, DismissingNotice, Notice } from './src/components/ui';
import { PAGES, type DecksStackParamList, type FriendsStackParamList, type LocationsStackParamList, type PageId, type TradesStackParamList, type TabParamList } from './src/navigation';
import { accent as accentColor, border, brand, space, surface, text as textColor, type as typeTokens } from './src/theme';
import { makeStyles } from './src/preferences';
import { initCrashReporting } from './src/crashReporting';

// Before anything renders, so a crash during startup is still caught. No-op without a DSN.
initCrashReporting();

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
  // Dashboard is the initial tab, and onStateChange does not fire for the initial
  // state, so this starts where the navigator actually starts.
  const [page, setPage] = useState<PageId>('Dashboard');
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <AppProvider>
          <ThemedNavigation
            onStateChange={state => setPage((state?.routes[state.index ?? 0]?.name as PageId | undefined) ?? 'Dashboard')}
          >
            {/* Inside the providers so the fallback can be themed; a crash anywhere
                below shows "Something went wrong" instead of a white screen. */}
            <ErrorBoundary context="app.shell">
              <RootShell fontsLoaded={fonts} page={page} onNavigatorMounted={() => setPage('Dashboard')} />
            </ErrorBoundary>
          </ThemedNavigation>
        </AppProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}

const navigationRef = createNavigationContainerRef<TabParamList>();

/** NavigationContainer with a theme built from our palette. Without it every
 * screen sits on React Navigation's own light grey, which shows as a band next
 * to our canvas colour and stays light in dark mode. */
function ThemedNavigation({ onStateChange, children }: {
  onStateChange(state: NavigationState | PartialState<NavigationState> | undefined): void; children: React.ReactNode;
}) {
  const { scheme } = usePreferences();
  const theme = React.useMemo(() => ({
    ...DefaultTheme,
    dark: scheme === 'dark',
    colors: { ...DefaultTheme.colors, primary: accentColor.DEFAULT, background: surface.canvas, card: surface.raised, text: textColor.primary, border: border.hairline, notification: accentColor.DEFAULT },
  }), [scheme]);
  return <NavigationContainer ref={navigationRef} theme={theme} onStateChange={onStateChange}>{children}</NavigationContainer>;
}

const Tab = createBottomTabNavigator<TabParamList>();
const DecksStack = createNativeStackNavigator<DecksStackParamList>();

function DecksNavigator() {
  return (
    <DecksStack.Navigator id="DecksStack" screenOptions={{ headerShown: false }}>
      <DecksStack.Screen name="DeckList" component={DecksScreen} />
      <DecksStack.Screen name="DeckDetail" component={DeckDetailScreen} options={{ headerShown: true, title: '', headerBackTitle: 'Decks', headerShadowVisible: false }} />
    </DecksStack.Navigator>
  );
}

const LocationsStack = createNativeStackNavigator<LocationsStackParamList>();

function LocationsNavigator() {
  return (
    <LocationsStack.Navigator id="LocationsStack" screenOptions={{ headerShown: false }}>
      <LocationsStack.Screen name="LocationList" component={LocationsScreen} />
      <LocationsStack.Screen name="LocationDetail" component={LocationDetailScreen} options={({ route }) => ({ headerShown: true, title: route.params.title, headerBackTitle: 'Locations' })} />
    </LocationsStack.Navigator>
  );
}

const FriendsStack = createNativeStackNavigator<FriendsStackParamList>();

function FriendsNavigator() {
  return (
    <FriendsStack.Navigator id="FriendsStack" screenOptions={{ headerShown: false }}>
      <FriendsStack.Screen name="FriendList" component={FriendsScreen} />
      <FriendsStack.Screen name="FriendProfile" component={FriendProfileScreen} options={({ route }) => ({ headerShown: true, title: route.params.username, headerBackTitle: 'Friends' })} />
    </FriendsStack.Navigator>
  );
}

// Cross-fades each tab's content on focus change (see TabBar.tsx's
// ScreenFade) -- one small wrapper per tab rather than baking the fade into
// every screen component individually.
// Its own boundary: a scanner crash (native view, OCR) keeps the header, tab
// bar and every other page alive. ScanScreen's unmount cleanup clears
// `scannerLive`, so the chrome comes back with the fallback.
function ScanTab() { return <ScreenFade><ErrorBoundary context="screen:scan" title="The scanner ran into a problem"><ScanScreen /></ErrorBoundary></ScreenFade>; }
function CollectionTab() { return <ScreenFade><CollectionScreen /></ScreenFade>; }
function DecksTab() { return <ScreenFade><DecksNavigator /></ScreenFade>; }
function SettingsTab() { return <ScreenFade><SettingsScreen /></ScreenFade>; }
// Pages that exist on the web but not in the app yet.
const placeholder = (id: PageId) => function PlaceholderTab() { return <ScreenFade><PlaceholderScreen page={id} /></ScreenFade>; };
function DashboardTab() { return <ScreenFade><DashboardScreen /></ScreenFade>; }
function LocationsTab() { return <ScreenFade><LocationsNavigator /></ScreenFade>; }
const SearchTab = placeholder('Search');
function WishlistTab() { return <ScreenFade><WishlistScreen /></ScreenFade>; }
const TradesStack = createNativeStackNavigator<TradesStackParamList>();

function TradesNavigator() {
  return (
    <TradesStack.Navigator id="TradesStack" screenOptions={{ headerShown: false }}>
      <TradesStack.Screen name="TradeList" component={TradesScreen} />
      <TradesStack.Screen name="TradeDetail" component={TradeDetailScreen} options={{ headerShown: true, title: 'Trade', headerBackTitle: 'Trades', headerShadowVisible: false }} />
      <TradesStack.Screen name="TradeBuilder" component={TradeBuilderScreen} options={{ headerShown: true, title: 'New offer', headerBackTitle: 'Trades', headerShadowVisible: false }} />
    </TradesStack.Navigator>
  );
}

function FriendsTab() { return <ScreenFade><FriendsNavigator /></ScreenFade>; }
function TradesTab() { return <ScreenFade><TradesNavigator /></ScreenFade>; }
function NotificationsTab() { return <ScreenFade><NotificationsScreen /></ScreenFade>; }
function ImportTab() { return <ScreenFade><ImportScreen /></ScreenFade>; }

function SignedInTabs({ onMounted }: { onMounted(): void }) {
  const app = useApp();
  // A fresh navigator always starts on Dashboard, but onStateChange does not fire
  // for its initial state -- without this, signing out and back in leaves
  // the tracked page at whatever the last one was.
  useEffect(() => { onMounted(); }, []);
  return (
    <Tab.Navigator
      id="RootTabs"
      initialRouteName="Dashboard"
      // The live camera is full-bleed: the bar would sit on top of the preview
      // and its own result sheet, and its top bar carries a back arrow instead.
      // Only while the camera is actually up -- the permission, download and
      // recovery panels on this same tab have no back arrow, so hiding the bar
      // there would leave a user who denied camera access unable to leave the
      // tab (or reach Settings to sign out).
      tabBar={props => (app.scannerLive && props.state.routes[props.state.index]?.name === 'Scan') ? null : <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Scan" component={ScanTab} />
      <Tab.Screen name="Dashboard" component={DashboardTab} />
      <Tab.Screen name="Collection" component={CollectionTab} />
      <Tab.Screen name="Locations" component={LocationsTab} />
      <Tab.Screen name="Decks" component={DecksTab} />
      <Tab.Screen name="Search" component={SearchTab} />
      <Tab.Screen name="Wishlist" component={WishlistTab} />
      <Tab.Screen name="Friends" component={FriendsTab} />
      <Tab.Screen name="Trades" component={TradesTab} />
      <Tab.Screen name="Notifications" component={NotificationsTab} />
      <Tab.Screen name="Import" component={ImportTab} />
      <Tab.Screen name="Settings" component={SettingsTab} />
    </Tab.Navigator>
  );
}

/**
 * The app header and the global banner are hidden only while the live camera
 * view is actually on screen (Scan focused AND `scannerLive`), so the camera
 * runs edge to edge and under the status bar. ScanScreen re-renders
 * `app.message` as an overlay inside itself for exactly that window — a
 * message must never become invisible just because the scanner is open. Every
 * other Scan-tab screen (session list, permission and download panels) is
 * ordinary content and keeps the header, banners and safe area.
 */
function RootShell({ fontsLoaded, page, onNavigatorMounted }: { fontsLoaded: boolean; page: PageId; onNavigatorMounted(): void }) {
  const styles = useStyles();
  const app = useApp();
  const titleStyle = fontsLoaded ? styles.title : styles.titleFallback;
  const signedIn = app.backendAvailable && !!app.userId;
  const { scheme, welcomeSeen, setWelcomeSeen } = usePreferences();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchApi = React.useMemo(() => ({ open: () => setSearchOpen(true) }), []);
  const [cardTarget, setCardTarget] = useState<CardDetailsTarget | null>(null);
  const cardApi = React.useMemo(() => ({ open: (t: CardDetailsTarget) => setCardTarget(t) }), []);
  const scanFocused = page === 'Scan';
  const unread = useUnreadCount(signedIn ? app.userId : null, page);

  // ONE stable tree. Rendering SignedInTabs in two different branches gave it
  // two different tree positions, so React unmounted and remounted the whole
  // navigator on every focus change -- which resets it to its initial route
  // (Scan) and would trap the user on the scanner. Only the chrome toggles;
  // the element holding the navigator never changes position.
  const fullBleed = signedIn && scanFocused && app.scannerLive;

  return (
    // edges omits 'bottom' deliberately -- the TabBar owns its own bottom
    // inset (see TabBar.tsx), and when it isn't rendered (no session) the
    // ScrollView content itself already pads its bottom edge. Full-bleed
    // takes no insets at all: the scanner draws under the status bar.
    <SearchOverlayContext.Provider value={searchApi}>
    <CardDetailsContext.Provider value={cardApi}>
    <SafeAreaView style={fullBleed ? styles.fullBleed : styles.safe} edges={fullBleed ? [] : ['top', 'left', 'right']}>
      <StatusBar barStyle={fullBleed || scheme === 'dark' ? 'light-content' : 'dark-content'} />
      {!fullBleed && signedIn && <AppHeader title={PAGES[page].title} fontsLoaded={fontsLoaded} onMenu={() => setMenuOpen(true)} unread={unread} />}
      {!fullBleed && !signedIn && (
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
          <AuthScreen />
        ) : (
          <SignedInTabs onMounted={onNavigatorMounted} />
        )}
      </View>
      {signedIn && <CatalogDownloadModal />}
      {/* Held back while the catalog ask is up: two iOS modals cannot present at once. */}
      {signedIn && <WelcomeWalkthrough visible={!welcomeSeen && !app.catalogBusy && !app.catalogUpdate} onDone={() => setWelcomeSeen(true)} />}
      {signedIn && <CardDetails name={cardTarget?.name ?? null} printingId={cardTarget?.printingId} scan={cardTarget?.scan} onClose={() => setCardTarget(null)} />}
      {signedIn && <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />}
      {signedIn && (
        <MenuSheet
          visible={menuOpen}
          current={page}
          unread={unread}
          onClose={() => setMenuOpen(false)}
          onSelect={id => { setMenuOpen(false); if (id === 'Search') setSearchOpen(true); else if (navigationRef.isReady()) navigationRef.navigate(id); }}
        />
      )}
    </SafeAreaView>
    </CardDetailsContext.Provider>
    </SearchOverlayContext.Provider>
  );
}

/** No backend configured: today's demo shape, unchanged -- Scan alone, no tabs. */
function DemoOnly() {
  return <ScanScreen />;
}

/**
 * Pinned above whatever the navigator is currently showing, so a message or
 * a recovered pending move is visible on every tab, not just the one it
 * happened to originate on. No forced navigation on recovery -- surfaced as
 * a tappable banner, per the owner's decision, never an automatic tab
 * switch.
 */
function GlobalBanners() {
  const { message, setMessage, pendingMove, moveBusy, retryPendingMove } = useApp();
  return (
    <>
      {message ? <DismissingNotice onDone={() => setMessage('')}>{message}</DismissingNotice> : null}
      {pendingMove && (
        <>
          <Notice>An unfinished move needs verifying: {pendingMove.label}.</Notice>
          <Button secondary label={moveBusy ? 'Verifying…' : 'Retry / verify move'} disabled={moveBusy} onPress={() => void retryPendingMove()} />
        </>
      )}
    </>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: surface.canvas },
  fullBleed: { flex: 1, backgroundColor: brand.ink },
  header: { paddingHorizontal: space.xxl, paddingTop: space.md, gap: 4 },
  eyebrow: { ...typeTokens.eyebrow, color: textColor.secondary },
  title: { fontFamily: 'Cinzel_600SemiBold', fontSize: typeTokens.display.fontSize, lineHeight: typeTokens.display.lineHeight, color: textColor.primary },
  titleFallback: { fontSize: typeTokens.display.fontSize, fontWeight: '600', color: textColor.primary },
  banners: { paddingHorizontal: space.xxl, gap: space.sm },
  content: { flex: 1 },
}));
