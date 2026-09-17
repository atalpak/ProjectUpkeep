import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useFonts } from 'expo-font';
import { Cinzel_600SemiBold } from '@expo-google-fonts/cinzel/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { CardIndex, ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, validateDraft, type Candidate, type ConfirmedScan, type Finish, type Printing } from '@upkeep/scan-core';
import { readText, visionAvailable } from '@upkeep/vision';
import { backend, writer } from './src/backend';
import { demoBundle, loadCatalog, refreshCatalog } from './src/catalog';
import { CollectionAuthError, fetchCollectionPage, PAGE_SIZE, type CollectionEntry } from './src/collection';
import { fetchDeckCards, fetchDeckHeader, fetchDecks, type DeckCardEntry, type DeckHeader, type DeckSummary } from './src/decks';

type Review = { printing: Printing; operationId: string; submitted?: ConfirmedScan };
type Location = {id: string; name: string; type: string};
// Third real screen (decks). Still a plain state switch, not a navigation
// library: the comment above this used to say "reach for React Navigation
// when a third screen makes the switch awkward to extend" — decks turned out
// not to be that trigger. It only needed one more sub-state (which deck, if
// any, is open) layered on top of the same tab switch, which is a smaller
// footprint than a route config and a navigator dependency for what is still
// three destinations behind one signed-in shell with no deep linking, no back
// stack beyond "close this deck", and no history to restore. Revisit this
// when a fourth destination (social, say) needs its own back stack or when
// two screens need to link directly to each other rather than only through
// this shell.
type Tab = 'scan' | 'collection' | 'decks';
// Mirrors src/app/(app)/collection/actions.ts's friendlyDbError: the trigger
// messages from the migrations are precise but written for whoever is reading
// the schema, not for someone scanning a card. card_instances_enforce_
// location_owner (migration 5) is the one this screen can actually reach —
// its destination picker only ever offers this account's own locations, but
// a stale picker (an unsynced screen, a location deleted in another tab)
// could still submit one that no longer belongs to this account.
function friendlyDbMessage(message: string): string {
  if (message.includes('must belong to owner_user_id')) {
    return 'That destination is no longer yours. Refresh and choose another.';
  }
  return message;
}
const errorMessage = (e: unknown) => friendlyDbMessage(e instanceof Error ? e.message : (e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Something went wrong. Please retry.'));
const pendingKey = (userId: string) => `upkeep.pending.${userId}`;

export default function App() {
  const [fonts] = useFonts({ Cinzel_600SemiBold, PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold });
  return <SafeAreaProvider><Scanner fonts={fonts} /></SafeAreaProvider>;
}
function Scanner({fonts}: {fonts: boolean}) {
  const [index, setIndex] = useState(() => new CardIndex(demoBundle));
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [tab, setTab] = useState<Tab>('scan');
  // Which deck is open on the decks tab, if any — null means "show the list".
  // This is the sub-state the comment on `Tab` describes instead of reaching
  // for a navigation library.
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [authBusy, setAuthBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const currentUser = useRef<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const camera = useRef<CameraView>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const demo = index.bundle.version === 'demo-only';
  const pipeline = useMemo(() => new ScanPipeline(index, { readText }), [index]);
  const titleStyle = fonts ? styles.title : styles.titleFallback;

  useEffect(() => {
    alive.current = true;
    setIndex(loadCatalog());
    const sub = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      if (state !== 'active') { controller.current?.abort(); setCameraOpen(false); setReady(false); backend?.auth.stopAutoRefresh(); }
      else backend?.auth.startAutoRefresh();
    });
    return () => { alive.current = false; controller.current?.abort(); sub.remove(); backend?.auth.stopAutoRefresh(); };
  }, []);
  useEffect(() => {
    if (!backend) return;
    const { data } = backend.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user.id ?? null;
      if (currentUser.current === nextUser) return;
      const previousUser = currentUser.current;
      currentUser.current = nextUser;
      controller.current?.abort(); setCameraOpen(false);
      setUserId(nextUser); setRecovering(!!nextUser);
      setReview(null); setRecent([]); setLocations([]); setTab('scan'); setOpenDeckId(null);
      // Sign-out clears the persisted session (Supabase's own job) but not
      // anything else this app wrote — so a pending scan must be cleared here,
      // or it would be stranded under an account nobody is signed into anymore
      // and could be picked up by whoever signs in next on this device.
      if (!nextUser && previousUser) void SecureStore.deleteItemAsync(pendingKey(previousUser));
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!backend || !userId) return;
    let cancelled = false;
    setRecovering(true);
    void (async () => {
      // locations.user_id is the owner column (see supabase/migrations/00000000000004_locations.sql —
      // card_instances uses owner_user_id, locations does not). Filtering explicitly, rather than
      // relying on RLS alone, matters here for the same reason it does in src/lib/collection/queries.ts:
      // migration 9 makes a friend's tradable locations legitimately readable, so an unscoped select
      // would mix a friend's binder into this list.
      const {data, error} = await backend.from('locations').select('id,name,type').eq('user_id', userId).order('name').limit(1000);
      if (cancelled) return;
      if (error) setMessage('Locations could not load. Unsorted remains available.');
      // A deck's list follows what is physically filed in it via a trigger that
      // only fires on insert or on a location_id change (migration 16), not on
      // a quantity change — so scanning a 4th copy into a deck the scanner
      // just merged into would grow the stack's quantity without the deck's
      // list ever hearing about the new copy. That gap is pre-existing and
      // shared with the web app's addCardInstance; the fix belongs to a later
      // phase. Hiding deck destinations here is a narrower fix: the flat,
      // unfiltered picker on this screen made it easy to hit by accident,
      // where the web app's add form is not the primary way decks are filled.
      else setLocations((data ?? []).filter(l => l.type !== 'deck'));
      try {
        const pending = await SecureStore.getItemAsync(pendingKey(userId));
        if (cancelled || !pending) return;
        const scan = JSON.parse(pending) as ConfirmedScan;
        const printing = index.get(scan.draft.card_id);
        if (!printing) { setMessage('An unfinished save needs its catalog. Refresh the catalog before scanning more cards.'); setBusy(true); return; }
        validateDraft(scan.draft, printing);
        setBusy(false);
        setReview({printing, operationId: scan.operationId, submitted:scan});
        setMessage('An unfinished save was recovered. Retry to verify whether it reached your collection.');
      } catch { setMessage('The pending save could not be recovered. Keep this installation and contact the developer before adding more cards.'); setBusy(true); }
      finally { if (!cancelled) setRecovering(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, index]);

  async function signIn() {
    if (!backend || authBusy) return;
    setAuthBusy(true); setMessage('');
    try {
      const {error} = await backend.auth.signInWithPassword({email:email.trim(),password});
      if (error) throw error;
      setPassword('');
    } catch (e) { setMessage(errorMessage(e)); } finally { setAuthBusy(false); }
  }
  async function capture() {
    if (!camera.current || !ready || lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    const task = new AbortController(); controller.current = task;
    let uri: string | undefined;
    try {
      const photo = await camera.current.takePictureAsync({quality:0.85, exif:false});
      uri = photo?.uri;
      if (!uri || task.signal.aborted) return;
      const result = await pipeline.scan(uri, task.signal);
      if (!alive.current || task.signal.aborted) return;
      setCandidates(result.candidates); setCameraOpen(false); setReady(false);
      setMessage(result.candidates.length ? 'Choose the exact printing below. A name match alone cannot identify its set or finish.' : 'No confident name match. Try better lighting, or search by name.');
    } catch (e) { if (alive.current && !task.signal.aborted) setMessage(errorMessage(e)); }
    finally {
      // Ownership of the temporary photo remains here until native recognition has settled.
      if (uri) { try { new File(uri).delete(); } catch { /* OS cache cleanup is a fallback */ } }
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function openCamera() {
    if (busy || recovering || catalogBusy || authBusy || review) return;
    try {
      const p = permission?.granted ? permission : await requestPermission();
      if (!p.granted) { setMessage('Camera access is off. Enable it in Settings, or search by name.'); return; }
      setReady(false); setCameraOpen(true);
    } catch (e) { setMessage(errorMessage(e)); }
  }
  async function syncCatalog() {
    setCatalogBusy(true); setMessage('');
    try { setIndex(await refreshCatalog()); setCandidates([]); setQuery(''); setMessage('Offline catalog updated.'); }
    catch (e) { setMessage(errorMessage(e)); } finally { setCatalogBusy(false); }
  }
  const disabled = busy || recovering || catalogBusy || authBusy || !!review;
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.top}><Text style={styles.eyebrow}>PROJECT UPKEEP</Text><Text style={styles.badge}>{demo ? 'DEMO CATALOG' : 'OFFLINE READY'}</Text></View>
      <Text style={titleStyle}>A place for every card.</Text>
      <Text style={styles.subtitle}>Scan. Choose your printing. Make it part of your collection.</Text>
      <View style={styles.account}>
        <Text style={styles.section}>{userId ? 'Connected to Upkeep' : backend ? 'Your Upkeep account' : 'Explore the scanner'}</Text>
        {!backend && <Text style={styles.body}>Demo mode uses three sample printings. Demo additions last for this session and do not change your collection.</Text>}
        {backend && !userId && <>
          <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoComplete="current-password" />
          <Button label={authBusy ? 'Signing in…' : 'Sign in'} disabled={disabled} onPress={() => void signIn()} />
        </>}
        {userId && <Button label="Sign out" secondary disabled={disabled} onPress={() => { void backend!.auth.signOut().then(({error}) => {if (error) setMessage(error.message);}); }} />}
      </View>
      {userId && <View style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='scan'}} style={[styles.tab,tab==='scan' && styles.tabSelected]} onPress={() => setTab('scan')}><Text style={tab==='scan' ? styles.tabTextSelected : styles.tabText}>Scan</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='collection'}} style={[styles.tab,tab==='collection' && styles.tabSelected]} onPress={() => setTab('collection')}><Text style={tab==='collection' ? styles.tabTextSelected : styles.tabText}>Collection</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{selected:tab==='decks'}} style={[styles.tab,tab==='decks' && styles.tabSelected]} onPress={() => setTab('decks')}><Text style={tab==='decks' ? styles.tabTextSelected : styles.tabText}>Decks</Text></Pressable>
      </View>}
      {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
      {tab === 'collection' && userId ? <CollectionScreen userId={userId} /> : tab === 'decks' && userId ? (
        openDeckId
          ? <DeckDetailScreen userId={userId} deckId={openDeckId} onBack={() => setOpenDeckId(null)} />
          : <DecksScreen userId={userId} onOpenDeck={setOpenDeckId} />
      ) : <>
      {review ? <ReviewCard key={review.operationId} review={review} demo={demo} userId={userId} locations={locations}
        onSubmitted={scan => setReview({...review,submitted:scan})}
        onMessage={setMessage} onCancel={() => setReview(null)}
        onSaved={() => {setRecent([`${review.printing.name} · ${review.printing.setCode.toUpperCase()} #${review.printing.collectorNumber}`, ...recent].slice(0,20)); setReview(null); setCandidates([]); setQuery(''); setMessage(demo ? 'Added to this demo session.' : 'Saved to your Upkeep collection.');}} /> : <>
        <View style={styles.cameraPanel}>
          {cameraOpen && active ? <>
            <CameraView ref={camera} style={styles.camera} facing="back" onCameraReady={() => setReady(true)} onMountError={() => {setReady(false);setCameraOpen(false);setMessage('Camera could not start. Use manual search or retry.');}} />
            <View pointerEvents="none" style={styles.guide}><Text style={styles.guideText}>Fill the frame with one card</Text></View>
          </> : <View style={styles.cameraPlaceholder}><Text style={styles.cardGlyph}>♧</Text><Text style={styles.cameraTitle}>Bring your next card into focus</Text><Text style={styles.cameraCaption}>{visionAvailable ? 'Text recognition stays on your phone.' : 'Use a development build for on-device OCR.'}</Text></View>}
        </View>
        <Button label={busy ? 'Reading card…' : cameraOpen ? 'Capture card' : 'Open camera'} disabled={disabled || (cameraOpen && !ready)} onPress={() => void (cameraOpen ? capture() : openCamera())} />
        {cameraOpen && <Button label="Close camera" secondary onPress={() => {controller.current?.abort();setCameraOpen(false);setReady(false);}} />}
        {permission && !permission.granted && !permission.canAskAgain && <Button secondary label="Open camera settings" onPress={() => void Linking.openSettings()} />}
        <Text style={styles.section}>Or find a card by name</Text>
        <TextInput accessibilityLabel="Card name" style={styles.input} placeholder={demo ? 'Try Lightning Bolt or Sol Ring' : 'Enter the full card name'} value={query} editable={!disabled} onChangeText={text => {setQuery(text); setCandidates(index.search(text));}} />
        {candidates.map(c => <Pressable accessibilityRole="button" disabled={disabled} key={c.printing.id} style={styles.result} onPress={() => {setCameraOpen(false);setReady(false);setReview({printing:c.printing,operationId:Crypto.randomUUID()});}}>
          {c.printing.imageUri && <Image source={{uri:c.printing.imageUri}} style={styles.thumbnail} />}
          <View style={styles.grow}><Text style={styles.resultTitle}>{c.printing.name}</Text><Text style={styles.body}>{c.printing.setCode.toUpperCase()} · #{c.printing.collectorNumber} · {c.printing.language.toUpperCase()}</Text><Text style={styles.hint}>{c.evidence === 'printing' ? 'Name + set / number match' : 'Verify set and collector number'}</Text></View><Text style={styles.arrow}>›</Text>
        </Pressable>)}
        {query.length > 1 && !candidates.length && <Text style={styles.body}>No match in this catalog. Check the name or refresh the catalog.</Text>}
      </>}
      <View style={styles.divider} />
      <Text style={styles.section}>Ready wherever you play</Text>
      <Text style={styles.body}>{index.bundle.printings.length.toLocaleString()} printings · {index.bundle.version}. Matching works offline; collection saves need a connection.</Text>
      <Button secondary label={catalogBusy ? 'Updating catalog…' : 'Refresh offline catalog'} disabled={catalogBusy || lock.current || !!review} onPress={() => void syncCatalog()} />
      {!!recent.length && <><Text style={styles.section}>{demo ? 'Demo session' : 'Added this session'}</Text>{recent.map((text,i) => <Text key={i} style={styles.body}>✓ {text}</Text>)}</>}
      </>}
      <Text style={styles.footer}>UPKEEP · SCAN / PHASE ONE</Text>
    </ScrollView>
  </SafeAreaView>;
}

// Read-only browse of the signed-in user's own collection. See
// src/collection.ts for the query itself and why it targets the
// collection_entries view rather than card_instances directly.
function CollectionScreen({userId}: {userId: string}) {
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [page, setPage] = useState(0);
  const [totalEntries, setTotalEntries] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // The page a failed attempt was actually for, so Retry resumes there
  // instead of discarding already-loaded pages back to the start.
  const lastAttempted = useRef(0);

  async function loadPage(nextPage: number) {
    lastAttempted.current = nextPage;
    nextPage === 0 ? setLoading(true) : setLoadingMore(true);
    setError(''); setAuthError(false);
    try {
      const result = await fetchCollectionPage(userId, nextPage);
      if (!alive.current) return;
      setEntries(prev => nextPage === 0 ? result.entries : [...prev, ...result.entries]);
      if (result.totalEntries !== null) setTotalEntries(result.totalEntries);
      setPage(nextPage);
    } catch (e) {
      if (!alive.current) return;
      // An expired/invalid session and an empty collection both reach this
      // catch as "no rows rendered" unless told apart explicitly — see
      // CollectionAuthError's own comment for why they must look different.
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) { setLoading(false); setLoadingMore(false); }
    }
  }
  useEffect(() => { void loadPage(0); }, [userId]);

  const cardsLoaded = entries.reduce((sum, e) => sum + e.quantity, 0);
  const hasMore = totalEntries !== null && entries.length < totalEntries;

  if (loading) return <Text style={styles.body}>Loading your collection…</Text>;
  if (authError) return <Text accessibilityRole="alert" style={styles.notice}>Your session is no longer valid. Sign out and sign in again to view your collection.</Text>;
  if (error) return <>
    <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>
    <Button secondary label="Retry" onPress={() => void loadPage(lastAttempted.current)} />
  </>;
  if (!entries.length) return <Text style={styles.body}>You don't own any cards yet. Scan one to get started.</Text>;

  return <>
    {/* Entries is an exact count from the first page's request; cards is a
        running sum of quantity over what has loaded so far, so it carries a
        "+" until every page has been fetched rather than implying a false
        precision. The two are deliberately not merged into one number — see
        CollectionEntry / fetchCollectionPage's comments. */}
    <Text style={styles.section}>{cardsLoaded}{hasMore ? '+' : ''} cards across {totalEntries} entries</Text>
    {entries.map(e => <View key={e.id} style={styles.result}>
      {e.card_image_uri_small && <Image source={{uri:e.card_image_uri_small}} style={styles.thumbnail} />}
      <View style={styles.grow}>
        <Text style={styles.resultTitle}>{e.card_name}</Text>
        <Text style={styles.body}>{e.card_set_code.toUpperCase()} · #{e.card_collector_number}</Text>
        <Text style={styles.body}>{e.condition.toUpperCase()} · {e.finish.toUpperCase()} · {e.language.toUpperCase()} · Qty {e.quantity} · {e.location_name ?? 'Unsorted'}</Text>
      </View>
    </View>)}
    {hasMore && <Button secondary label={loadingMore ? 'Loading…' : 'Load more'} disabled={loadingMore} onPress={() => void loadPage(page + 1)} />}
  </>;
}

// Read-only list of the signed-in user's own decks. See src/decks.ts for the
// query and why its owner filter (`user_id`, not `owner_user_id`) is
// mandatory rather than a nicety.
function DecksScreen({userId, onOpenDeck}: {userId: string; onOpenDeck(deckId: string): void}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function load() {
    setLoading(true); setError(''); setAuthError(false);
    try {
      const result = await fetchDecks(userId);
      if (alive.current) setDecks(result);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [userId]);

  if (loading) return <Text style={styles.body}>Loading your decks…</Text>;
  if (authError) return <Text accessibilityRole="alert" style={styles.notice}>Your session is no longer valid. Sign out and sign in again to view your decks.</Text>;
  if (error) return <>
    <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>
    <Button secondary label="Retry" onPress={() => void load()} />
  </>;
  if (!decks.length) return <Text style={styles.body}>You don't have any decks yet. Build one on the web app to see it here.</Text>;

  return <>
    <Text style={styles.section}>{decks.length} deck{decks.length === 1 ? '' : 's'}</Text>
    {decks.map(d => <Pressable accessibilityRole="button" key={d.id} style={styles.result} onPress={() => onOpenDeck(d.id)}>
      <View style={styles.grow}>
        <Text style={styles.resultTitle}>{d.name}</Text>
        <Text style={styles.body}>{d.format ?? 'No format set'}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>)}
  </>;
}

// One deck's decklist, read-only, with each entry's sleeved-vs-wanted count —
// see src/decks.ts's header for why that number needs two separate queries
// (deck_cards for "wanted", card_instances for "sleeved") rather than one.
function DeckDetailScreen({userId, deckId, onBack}: {userId: string; deckId: string; onBack(): void}) {
  const [header, setHeader] = useState<DeckHeader | null>(null);
  const [cards, setCards] = useState<DeckCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function load() {
    setLoading(true); setError(''); setAuthError(false);
    try {
      const [h, c] = await Promise.all([fetchDeckHeader(userId, deckId), fetchDeckCards(userId, deckId)]);
      if (!alive.current) return;
      setHeader(h); setCards(c);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof CollectionAuthError) setAuthError(true);
      else setError(errorMessage(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [userId, deckId]);

  return <>
    <Button secondary label="‹ Back to decks" onPress={onBack} />
    {loading && <Text style={styles.body}>Loading deck…</Text>}
    {authError && <Text accessibilityRole="alert" style={styles.notice}>Your session is no longer valid. Sign out and sign in again to view this deck.</Text>}
    {!loading && error && <>
      <Text accessibilityRole="alert" style={styles.notice}>{error}</Text>
      <Button secondary label="Retry" onPress={() => void load()} />
    </>}
    {!loading && !authError && !error && header && <>
      {header.commanderImageUriSmall && <Image source={{uri: header.commanderImageUriSmall}} style={styles.thumbnail} />}
      <Text style={styles.section}>{header.name}</Text>
      <Text style={styles.body}>{header.format ?? 'No format set'}{header.commanderName ? ` · Commander: ${header.commanderName}` : ''}</Text>
      {!cards.length && <Text style={styles.body}>This deck's list is empty.</Text>}
      {cards.map(c => {
        const fullySleeved = c.sleeved >= c.quantity;
        const noneSleeved = c.sleeved === 0;
        return <View key={c.id} style={[styles.result, noneSleeved && styles.deckRowUnsleeved]}>
          {c.imageUriSmall && <Image source={{uri: c.imageUriSmall}} style={styles.thumbnail} />}
          <View style={styles.grow}>
            <Text style={[styles.resultTitle, noneSleeved && styles.deckRowUnsleevedText]}>{c.name}</Text>
            <Text style={styles.body}>{c.setCode.toUpperCase()} · #{c.collectorNumber} · Qty {c.quantity}</Text>
            <Text style={[styles.body, fullySleeved ? styles.deckRowSleevedText : noneSleeved ? styles.deckRowUnsleevedText : undefined]}>
              {c.sleeved}/{c.quantity} sleeved
            </Text>
          </View>
        </View>;
      })}
    </>}
  </>;
}

function ReviewCard({review,demo,userId,locations,onSubmitted,onSaved,onCancel,onMessage}: {
  review: Review; demo: boolean; userId: string | null; locations: Location[];
  onSubmitted(scan: ConfirmedScan): void; onSaved(): void; onCancel(): void; onMessage(text: string): void;
}) {
  const {printing,submitted} = review;
  const [finish,setFinish] = useState<Finish | undefined>(submitted?.draft.finish);
  const [condition,setCondition] = useState(submitted?.draft.condition);
  const [language,setLanguage] = useState(submitted?.draft.language ?? '');
  const [quantity,setQuantity] = useState(String(submitted?.draft.quantity ?? 1));
  const [location,setLocation] = useState<string | null>(submitted?.draft.location_id ?? null);
  const [saving,setSaving] = useState(false);
  const savingRef = useRef(false);
  const confirm = useMemo(() => writer ? new ConfirmScan(writer) : null, []);
  const locked = !!submitted || saving;
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const draft = validateDraft({card_id:printing.id, finish:finish!, condition:condition!, language,
        quantity: /^\d+$/.test(quantity) ? Number(quantity) : NaN, location_id:location, notes:null}, printing);
      if (demo) { onSaved(); return; }
      if (!confirm || !userId) throw new Error('Sign in to Upkeep before saving.');
      const scan = submitted ?? {operationId:review.operationId,draft};
      // Persist BEFORE writing. A crash or lost response can be retried with the same primary key.
      await SecureStore.setItemAsync(pendingKey(userId), JSON.stringify(scan));
      onSubmitted(scan);
      await confirm.save(scan, printing);
      await SecureStore.deleteItemAsync(pendingKey(userId));
      onSaved();
    } catch (e) { onMessage(errorMessage(e)); } finally {savingRef.current = false; setSaving(false);}
  }
  return <View style={styles.review}>
    <Text style={styles.eyebrow}>CONFIRM YOUR CARD</Text><Text style={styles.section}>{printing.name}</Text>
    {printing.imageUri && <Image source={{uri:printing.imageUri}} style={styles.cardImage} resizeMode="contain" />}
    <Text style={styles.body}>{printing.setCode.toUpperCase()} · #{printing.collectorNumber}</Text>
    <Text style={styles.label}>Finish</Text><Choices values={printing.finishes} selected={finish} disabled={locked} onSelect={v => setFinish(v as Finish)} />
    <Text style={styles.label}>Condition</Text><Choices values={[...CONDITIONS]} selected={condition} disabled={locked} onSelect={v => setCondition(v as typeof CONDITIONS[number])} />
    <Text style={styles.label}>Language on your card</Text><Choices values={[...LANGUAGES]} selected={language} disabled={locked} onSelect={setLanguage} />
    <Text style={styles.label}>Quantity</Text><TextInput accessibilityLabel="Quantity" style={styles.input} value={quantity} onChangeText={setQuantity} editable={!locked} keyboardType="number-pad" />
    <Text style={styles.label}>Destination</Text><Choices values={['',...locations.map(l => l.id)]} selected={location ?? ''} disabled={locked} onSelect={v => setLocation(v || null)} labels={Object.fromEntries([['','Unsorted'],...locations.map(l => [l.id,l.name])])} />
    {submitted && <Text style={styles.notice}>These details are locked for a safe retry. Retrying can never add this card twice, whether it lands in a new row or merges into a stack you already have.</Text>}
    <Button label={saving ? 'Saving…' : demo ? 'Add to demo session' : submitted ? 'Retry / verify save' : 'Add to collection'} disabled={saving || !finish || !condition || !language || (!demo && !userId)} onPress={() => void save()} />
    {!submitted && <Button secondary label="Choose another printing" disabled={saving} onPress={onCancel} />}
  </View>;
}
function Choices({values,selected,disabled,onSelect,labels={}}: {values:string[]; selected?:string; disabled?:boolean; onSelect(v:string):void; labels?:Record<string,string>}) {
  return <View style={styles.choices}>{values.map(v => <Pressable key={v} accessibilityRole="radio" accessibilityState={{selected:v===selected,disabled}} disabled={disabled} onPress={() => onSelect(v)} style={[styles.chip,v===selected && styles.chipSelected]}><Text style={v===selected ? styles.chipTextSelected : styles.body}>{labels[v] ?? v.toUpperCase()}</Text></Pressable>)}</View>;
}
function Button({label,onPress,disabled,secondary}: {label:string; onPress():void; disabled?:boolean; secondary?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} onPress={onPress} disabled={disabled} style={[styles.button,secondary && styles.buttonSecondary,disabled && styles.disabled]}><Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#f5f0e6'},page:{padding:24,paddingBottom:40,maxWidth:640,width:'100%',alignSelf:'center',gap:14},top:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},eyebrow:{fontSize:10,letterSpacing:2,color:'#6b552e',fontWeight:'700'},badge:{fontSize:9,letterSpacing:1,color:'#6b552e',borderWidth:1,borderColor:'#d6c7a8',borderRadius:20,paddingHorizontal:10,paddingVertical:5},
  title:{fontFamily:'Cinzel_600SemiBold',fontSize:34,lineHeight:43,color:'#2a3028'},titleFallback:{fontSize:34,fontWeight:'600',color:'#2a3028'},subtitle:{fontFamily:'PlusJakartaSans_400Regular',fontSize:15,lineHeight:24,color:'#66685b'},body:{fontFamily:'PlusJakartaSans_400Regular',fontSize:13,lineHeight:21,color:'#626456'},section:{fontSize:18,fontWeight:'600',color:'#293428',marginTop:8},account:{padding:16,backgroundColor:'#eee7d8',borderRadius:16,gap:10},input:{backgroundColor:'#fffdf8',borderColor:'#d4ccb9',borderWidth:1,borderRadius:10,padding:14,color:'#293428',fontSize:16},
  cameraPanel:{height:310,borderRadius:20,overflow:'hidden',backgroundColor:'#263d35'},camera:{flex:1},cameraPlaceholder:{flex:1,alignItems:'center',justifyContent:'center',padding:28,gap:12},cardGlyph:{fontSize:68,color:'#d4ae65'},cameraTitle:{color:'#f4ecda',fontSize:21,textAlign:'center',fontWeight:'600'},cameraCaption:{color:'#c2ccb8',fontSize:13,textAlign:'center'},guide:{position:'absolute',top:'8%',bottom:'8%',left:'19%',right:'19%',borderColor:'#e2ba70',borderWidth:2,borderRadius:12,justifyContent:'flex-end'},guideText:{color:'#fff',backgroundColor:'#263d35',fontSize:10,textAlign:'center',padding:6},
  button:{padding:16,backgroundColor:'#b58538',borderRadius:12,alignItems:'center'},buttonSecondary:{backgroundColor:'transparent',borderWidth:1,borderColor:'#cbbd9e'},buttonText:{fontFamily:'PlusJakartaSans_600SemiBold',fontSize:15,fontWeight:'700',color:'#fffdf6'},secondaryText:{fontSize:14,fontWeight:'600',color:'#655332'},disabled:{opacity:0.4},notice:{backgroundColor:'#ebe1c9',padding:14,borderRadius:10,color:'#5e4928',fontSize:13,lineHeight:21},result:{flexDirection:'row',gap:14,alignItems:'center',backgroundColor:'#fffdf8',borderWidth:1,borderColor:'#ddd3bd',padding:14,borderRadius:12},resultTitle:{fontSize:16,fontWeight:'600',color:'#293428'},hint:{fontSize:11,color:'#8c692c',marginTop:5},thumbnail:{width:45,height:63,borderRadius:3},grow:{flex:1},arrow:{fontSize:28,color:'#a17d40'},review:{gap:12,backgroundColor:'#fffaf0',padding:18,borderRadius:16},cardImage:{height:260,width:'100%'},label:{fontSize:13,fontWeight:'700',color:'#374131',marginTop:8},choices:{flexDirection:'row',flexWrap:'wrap',gap:7},chip:{paddingVertical:8,paddingHorizontal:11,borderRadius:8,borderWidth:1,borderColor:'#d4ccb9'},chipSelected:{backgroundColor:'#334c3f',borderColor:'#334c3f'},chipTextSelected:{color:'#fffdf6',fontSize:13,lineHeight:21},divider:{height:1,backgroundColor:'#d7cbb4',marginVertical:10},footer:{textAlign:'center',fontSize:9,color:'#8a8979',letterSpacing:2,marginTop:24},
  tabs:{flexDirection:'row',backgroundColor:'#eee7d8',borderRadius:12,padding:4,gap:4},tab:{flex:1,paddingVertical:10,borderRadius:9,alignItems:'center'},tabSelected:{backgroundColor:'#334c3f'},tabText:{fontSize:13,fontWeight:'600',color:'#655332'},tabTextSelected:{fontSize:13,fontWeight:'600',color:'#fffdf6'},
  // A card with nothing sleeved needs to visibly recede — the "what do I
  // still need to sleeve" glance this feature exists for depends on the
  // unsleeved rows reading as muted at a glance, not just via smaller text.
  deckRowUnsleeved:{opacity:0.55,borderStyle:'dashed'},deckRowUnsleevedText:{color:'#8c692c'},deckRowSleevedText:{color:'#2f6b45',fontWeight:'700'},
});
