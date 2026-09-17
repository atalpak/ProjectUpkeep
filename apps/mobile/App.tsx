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
import { CardIndex, ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, validateDraft, type Candidate, type Condition, type ConfirmedScan, type Finish, type Printing, type StackMoveDraft } from '@upkeep/scan-core';
import { readText, visionAvailable } from '@upkeep/vision';
import { backend, writer, moveWriter } from './src/backend';
import { demoBundle, loadCatalog, refreshCatalog } from './src/catalog';
import { CollectionAuthError, fetchCollectionPage, PAGE_SIZE, type CollectionEntry } from './src/collection';
import { fetchDeckCards, fetchDeckHeader, fetchDecks, fetchSleevedStacks, fetchSpareStacks, type DeckCardEntry, type DeckHeader, type DeckSummary, type SleeveCandidate } from './src/decks';

type Review = { printing: Printing; operationId: string; submitted?: ConfirmedScan };
type Location = {id: string; name: string; type: string};
/**
 * A move (sleeve/unsleeve) recovered across an app restart the same way a
 * pending scan is — see pendingMoveKey below and .claude/rules/mobile.md's
 * "Auth persistence" section, which this reuses rather than inventing a
 * second recovery pattern. `label` is display-only, for the retry banner.
 */
type PendingMove = { operationId: string; draft: StackMoveDraft; label: string };
/**
 * Finish/condition/language/destination remembered from the last card
 * ReviewCard finished with, so the next scan's review screen opens
 * pre-filled instead of blank — scanning a box of commons means dozens of
 * cards in a row that are all non-foil / near-mint / English, and retapping
 * three chips per card for that is exactly the kind of friction this app
 * should not add on top of "did I already sleeve this". Quantity is
 * deliberately NOT part of this: it is the one field that genuinely varies
 * per physical card, and defaulting it risks a silently wrong save (one
 * Sol Ring recorded as four because the last card scanned was a foil
 * playset). Session-only by design — lives in Scanner's state, not
 * SecureStore, so a fresh app launch starts blank rather than carrying a
 * stale guess across days.
 */
type LastUsedDraft = { finish: Finish; condition: Condition; language: string; location_id: string | null };
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
  // apply_stack_move (migration 38) retries a stale destination target, and a
  // stale source, once each automatically (packages/scan-core/src/move.ts) —
  // reaching here means both attempts failed, so the honest message is "this
  // needs a fresh look", not "try the exact same thing again".
  if (message.includes('no longer matches what was decided')) {
    return 'That copy changed since you picked it — close this and pick again.';
  }
  if (message.includes('no longer matches the decided target')) {
    return 'That stack changed while this was in flight. Close this and try again.';
  }
  return message;
}
const errorMessage = (e: unknown) => friendlyDbMessage(e instanceof Error ? e.message : (e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Something went wrong. Please retry.'));
const pendingKey = (userId: string) => `upkeep.pending.${userId}`;
// Same persist-before-write shape as pendingKey above, its own key so a
// pending scan and a pending move can never collide or overwrite each other.
const pendingMoveKey = (userId: string) => `upkeep.pending-move.${userId}`;

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
  // Typed narrowing fields for the manual-search picker (mobile-app phase 5):
  // unlike the OCR-derived hints the camera path uses, a value typed here is
  // a genuine filter -- it excludes non-matching printings rather than only
  // re-ranking them. See CardIndex.search's own header comment in scan-core.
  const [filterSetCode, setFilterSetCode] = useState('');
  const [filterCollectorNumber, setFilterCollectorNumber] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  // The true match count before CardIndex truncates to its result page, so
  // the picker can say "50 of 118 matched" honestly instead of silently
  // showing a capped list with no sign more printings exist.
  const [matchTotal, setMatchTotal] = useState(0);
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
  // A sleeve/unsleeve recovered after an app restart — same shape as `review`
  // for a pending scan, surfaced as a banner rather than inline because a
  // move can be recovered while the user is on any tab, not just the decks
  // one it was started from.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  // See LastUsedDraft's own comment: the defaults for the NEXT ReviewCard,
  // not a lock — that card can still change any of them before saving.
  const [lastUsedDraft, setLastUsedDraft] = useState<LastUsedDraft | null>(null);
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
      setReview(null); setRecent([]); setLocations([]); setTab('scan'); setOpenDeckId(null); setPendingMove(null);
      // Sign-out clears the persisted session (Supabase's own job) but not
      // anything else this app wrote — so a pending scan (and, as of phase
      // 4b/4c, a pending sleeve/unsleeve) must be cleared here, or it would be
      // stranded under an account nobody is signed into anymore and could be
      // picked up by whoever signs in next on this device.
      if (!nextUser && previousUser) {
        void SecureStore.deleteItemAsync(pendingKey(previousUser));
        void SecureStore.deleteItemAsync(pendingMoveKey(previousUser));
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  // Recovers a sleeve/unsleeve interrupted mid-request (app killed, lost
  // response) the same way the effect below recovers a pending scan: surface
  // it and require an explicit retry tap, never an automatic background
  // replay. Kept as its own effect, deliberately independent of the scan
  // recovery effect's busy/recovering flags below — a stuck pending move must
  // not block scanning, and vice versa.
  useEffect(() => {
    if (!backend || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(pendingMoveKey(userId));
        if (cancelled || !raw) return;
        const pending = JSON.parse(raw) as PendingMove;
        setPendingMove(pending);
        setMessage(m => m || 'An unfinished sleeve/unsleeve was recovered. Retry to verify whether it went through.');
      } catch {
        // A malformed pending-move record cannot be retried meaningfully;
        // drop it rather than surfacing a retry button that can never work.
        if (!cancelled) void SecureStore.deleteItemAsync(pendingMoveKey(userId));
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
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
      // A deck's list follows what is physically filed in it via a trigger.
      // Migration 16 only wired it to fire on insert or on a location_id
      // change, so a quantity-only sleeve into an already-sleeved stack was
      // invisible to it -- migration 37 (phase 4b) closed that gap at the
      // database level, and apply_stack_move (migration 38) is what actually
      // produces that quantity-only shape for a decided sleeve. This picker
      // still excludes deck destinations, though, for an unrelated reason:
      // it is a flat, unfiltered list with no per-deck "sleeved vs wanted"
      // context, unlike the decks tab's own sleeve action, so filing a scan
      // straight into a deck from here would bypass the list-aware UI on
      // purpose built for that decision.
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
  /**
   * Re-runs the manual-search picker against the current name query and the
   * typed set-code / collector-number filter fields, keeping `matchTotal` in
   * step with whatever `candidates` shows (see CardIndex.searchWithTotal).
   */
  function runSearch(name: string, setCode: string, collectorNumber: string) {
    const { results, total } = index.searchWithTotal(name, {}, {
      ...(setCode.trim() ? { setCode: setCode.trim() } : {}),
      ...(collectorNumber.trim() ? { collectorNumber: collectorNumber.trim() } : {}),
    });
    setCandidates(results); setMatchTotal(total);
  }
  async function syncCatalog() {
    setCatalogBusy(true); setMessage('');
    try { setIndex(await refreshCatalog()); setCandidates([]); setMatchTotal(0); setQuery(''); setFilterSetCode(''); setFilterCollectorNumber(''); setMessage('Offline catalog updated.'); }
    catch (e) { setMessage(errorMessage(e)); } finally { setCatalogBusy(false); }
  }
  /**
   * Sleeves or unsleeves one decided stack, through apply_stack_move
   * (migration 38) via createMoveWriter (packages/scan-core/src/move.ts).
   *
   * Same persist-before-write shape phase 1 established for a scan (see
   * ReviewCard.save): the intent is written to SecureStore, under its own
   * key, BEFORE the call goes out, so a crash or lost response mid-request
   * leaves something recoverable rather than an unknown. On success the
   * pending record is cleared; on failure it is deliberately left in place
   * (and pendingMove stays set) so the retry banner can pick it up with the
   * SAME operation id -- never a fresh one, which is what makes a retry safe
   * rather than a second application.
   */
  async function beginMove(draft: StackMoveDraft, label: string) {
    if (!moveWriter || !userId) throw new Error('Sign in to move cards in your collection.');
    const operationId = Crypto.randomUUID();
    const pending: PendingMove = { operationId, draft, label };
    await SecureStore.setItemAsync(pendingMoveKey(userId), JSON.stringify(pending));
    setPendingMove(pending);
    const result = await moveWriter.move({ operationId, draft });
    await SecureStore.deleteItemAsync(pendingMoveKey(userId));
    setPendingMove(null);
    return result;
  }
  async function retryPendingMove() {
    if (!pendingMove || !moveWriter || !userId || moveBusy) return;
    setMoveBusy(true); setMessage('');
    try {
      await moveWriter.move({ operationId: pendingMove.operationId, draft: pendingMove.draft });
      await SecureStore.deleteItemAsync(pendingMoveKey(userId));
      setPendingMove(null);
      setMessage('Verified — your collection is up to date.');
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setMoveBusy(false); }
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
      {/* A move recovered after a restart, wherever the app currently is —
          unlike a pending scan (surfaced inline as a locked ReviewCard), a
          sleeve/unsleeve has no screen of its own to reopen into, so this is
          a standing banner with its own explicit retry, not automatic. */}
      {pendingMove && <>
        <Text accessibilityRole="alert" style={styles.notice}>An unfinished move needs verifying: {pendingMove.label}.</Text>
        <Button secondary label={moveBusy ? 'Verifying…' : 'Retry / verify move'} disabled={moveBusy} onPress={() => void retryPendingMove()} />
      </>}
      {tab === 'collection' && userId ? <CollectionScreen userId={userId} /> : tab === 'decks' && userId ? (
        openDeckId
          ? <DeckDetailScreen userId={userId} deckId={openDeckId} onBack={() => setOpenDeckId(null)} onMove={beginMove} moveDisabled={!!pendingMove || moveBusy} />
          : <DecksScreen userId={userId} onOpenDeck={setOpenDeckId} />
      ) : <>
      {review ? <ReviewCard key={review.operationId} review={review} demo={demo} userId={userId} locations={locations} defaults={lastUsedDraft}
        onSubmitted={scan => setReview({...review,submitted:scan})}
        onMessage={setMessage} onCancel={() => setReview(null)}
        onSaved={draft => {setLastUsedDraft(draft); setRecent([`${review.printing.name} · ${review.printing.setCode.toUpperCase()} #${review.printing.collectorNumber}`, ...recent].slice(0,20)); setReview(null); setCandidates([]); setMatchTotal(0); setQuery(''); setFilterSetCode(''); setFilterCollectorNumber(''); setMessage(demo ? 'Added to this demo session.' : 'Saved to your Upkeep collection.');}} /> : <>
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
        <TextInput accessibilityLabel="Card name" style={styles.input} placeholder={demo ? 'Try Lightning Bolt or Sol Ring' : 'Enter the full card name'} value={query} editable={!disabled} onChangeText={text => {setQuery(text); runSearch(text, filterSetCode, filterCollectorNumber);}} />
        {/* Narrowing fields, not another name search -- a card with 100+
            printings (Lightning Bolt, say) needs a way to reach past the
            default 50-result page, and typing the set/number here actually
            excludes non-matching printings (CardIndex's filter mode) rather
            than just re-ranking them the way an OCR hint would. */}
        <View style={styles.row}>
          <TextInput accessibilityLabel="Set code" style={[styles.input, styles.grow]} placeholder="Set (optional)" autoCapitalize="characters" value={filterSetCode} editable={!disabled} onChangeText={text => {setFilterSetCode(text); runSearch(query, text, filterCollectorNumber);}} />
          <TextInput accessibilityLabel="Collector number" style={[styles.input, styles.grow]} placeholder="# (optional)" value={filterCollectorNumber} editable={!disabled} onChangeText={text => {setFilterCollectorNumber(text); runSearch(query, filterSetCode, text);}} />
        </View>
        {matchTotal > candidates.length && <Text style={styles.body}>Showing {candidates.length} of {matchTotal} matched — narrow with a set code or collector number above.</Text>}
        {candidates.map(c => <Pressable accessibilityRole="button" disabled={disabled} key={c.printing.id} style={styles.result} onPress={() => {setCameraOpen(false);setReady(false);setReview({printing:c.printing,operationId:Crypto.randomUUID()});}}>
          {c.printing.imageUri && <Image source={{uri:c.printing.imageUri}} style={styles.thumbnail} />}
          <View style={styles.grow}><Text style={styles.resultTitle}>{c.printing.name}</Text><Text style={styles.body}>{c.printing.setName ?? c.printing.setCode.toUpperCase()} · #{c.printing.collectorNumber} · {c.printing.language.toUpperCase()}</Text><Text style={styles.hint}>{c.evidence === 'printing' ? 'Name + set / number match' : 'Verify set and collector number'}</Text></View><Text style={styles.arrow}>›</Text>
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

// Which entry's sleeve/unsleeve picker is open, if any — the same
// single-sub-state approach the `Tab`/`openDeckId` comment describes, one
// level deeper. Only one entry's picker is ever open at a time.
type ActivePicker = { entryId: string; mode: 'sleeve' | 'unsleeve' };

// One deck's decklist, with each entry's sleeved-vs-wanted count — see
// src/decks.ts's header for why that number needs two separate queries
// (deck_cards for "wanted", card_instances for "sleeved") rather than one —
// plus, as of phase 4b/4c, a sleeve/unsleeve action per entry.
function DeckDetailScreen({userId, deckId, onBack, onMove, moveDisabled}: {
  userId: string; deckId: string; onBack(): void;
  onMove(draft: StackMoveDraft, label: string): Promise<{ instanceId: string; quantity: number; replayed: boolean }>;
  moveDisabled: boolean;
}) {
  const [header, setHeader] = useState<DeckHeader | null>(null);
  const [cards, setCards] = useState<DeckCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [error, setError] = useState('');
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
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
        const picking = activePicker?.entryId === c.id;
        return <View key={c.id}>
          <View style={[styles.result, noneSleeved && styles.deckRowUnsleeved]}>
            {c.imageUriSmall && <Image source={{uri: c.imageUriSmall}} style={styles.thumbnail} />}
            <View style={styles.grow}>
              <Text style={[styles.resultTitle, noneSleeved && styles.deckRowUnsleevedText]}>{c.name}</Text>
              <Text style={styles.body}>{c.setCode.toUpperCase()} · #{c.collectorNumber} · Qty {c.quantity}</Text>
              <Text style={[styles.body, fullySleeved ? styles.deckRowSleevedText : noneSleeved ? styles.deckRowUnsleevedText : undefined]}>
                {c.sleeved}/{c.quantity} sleeved
              </Text>
              <View style={styles.choices}>
                {!fullySleeved && <Button secondary label={picking && activePicker?.mode === 'sleeve' ? 'Cancel' : 'Sleeve'} disabled={moveDisabled}
                  onPress={() => setActivePicker(picking && activePicker?.mode === 'sleeve' ? null : { entryId: c.id, mode: 'sleeve' })} />}
                {!noneSleeved && <Button secondary label={picking && activePicker?.mode === 'unsleeve' ? 'Cancel' : 'Unsleeve'} disabled={moveDisabled}
                  onPress={() => setActivePicker(picking && activePicker?.mode === 'unsleeve' ? null : { entryId: c.id, mode: 'unsleeve' })} />}
              </View>
            </View>
          </View>
          {picking && <SleevePicker userId={userId} deckId={deckId} entry={c} mode={activePicker!.mode} onMove={onMove}
            onClose={() => setActivePicker(null)}
            onMoved={() => { setActivePicker(null); void load(); }} />}
        </View>;
      })}
    </>}
  </>;
}

/**
 * Lists the candidate stacks for one deck entry's sleeve (spare copies
 * elsewhere) or unsleeve (copies already in this deck) action, and applies
 * the tap through apply_stack_move via `onMove` (App's beginMove).
 *
 * Deliberately one call per tap, moving exactly one candidate stack, rather
 * than auto-filling a shortfall from several stacks at once — see
 * src/decks.ts's header on fetchSpareStacks/fetchSleevedStacks for why: each
 * apply_stack_move call moves from exactly one source row, and letting the
 * user pick which stack moves (rather than a hidden "smallest first"
 * algorithm choosing for them) keeps this phase's picker simple to reason
 * about and to review.
 */
function SleevePicker({userId, deckId, entry, mode, onMove, onClose, onMoved}: {
  userId: string; deckId: string; entry: DeckCardEntry; mode: 'sleeve' | 'unsleeve';
  onMove(draft: StackMoveDraft, label: string): Promise<{ instanceId: string; quantity: number; replayed: boolean }>;
  onClose(): void; onMoved(): void;
}) {
  const [candidates, setCandidates] = useState<SleeveCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void (async () => {
      try {
        const list = mode === 'sleeve'
          ? await fetchSpareStacks(userId, deckId, entry.oracleId, entry.name)
          : await fetchSleevedStacks(userId, deckId, entry.oracleId, entry.name);
        if (!cancelled) setCandidates(list);
      } catch (e) { if (!cancelled) setError(errorMessage(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, deckId, entry.oracleId, entry.name, mode]);

  async function pick(candidate: SleeveCandidate) {
    if (busy) return;
    setBusy(true); setError('');
    // Sleeve: take only what is still needed, capped at what this stack has.
    // Unsleeve: this phase moves a picked stack out whole, rather than
    // adding a partial-quantity input the picker does not otherwise need —
    // "which stack", not "how many of it", is the decision this UI asks for.
    const remaining = Math.max(1, entry.quantity - entry.sleeved);
    const quantity = mode === 'sleeve' ? Math.min(remaining, candidate.quantity) : candidate.quantity;
    const label = `${mode === 'sleeve' ? 'Sleeve' : 'Unsleeve'} ${quantity} ${entry.name} (${candidate.setCode.toUpperCase()} #${candidate.collectorNumber})`;
    try {
      await onMove({
        sourceInstanceId: candidate.id,
        cardId: candidate.cardId,
        condition: candidate.condition as Condition,
        finish: candidate.finish as Finish,
        language: candidate.language,
        quantity,
        destinationLocationId: mode === 'sleeve' ? deckId : null,
      }, label);
      if (alive.current) onMoved();
    } catch (e) { if (alive.current) setError(errorMessage(e)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <View style={styles.review}>
    <Text style={styles.label}>{mode === 'sleeve' ? `Sleeve ${entry.name} from…` : `Unsleeve ${entry.name} to Unsorted from…`}</Text>
    {loading && <Text style={styles.body}>Loading…</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
    {!loading && !candidates.length && <Text style={styles.body}>
      {mode === 'sleeve' ? 'No spare copies of this card elsewhere in your collection.' : 'Nothing of this card is currently sleeved in this deck.'}
    </Text>}
    {candidates.map(cand => <Pressable key={cand.id} accessibilityRole="button" disabled={busy} style={styles.result} onPress={() => void pick(cand)}>
      <View style={styles.grow}>
        <Text style={styles.resultTitle}>{cand.setCode.toUpperCase()} · #{cand.collectorNumber} · Qty {cand.quantity}</Text>
        <Text style={styles.body}>{cand.condition.toUpperCase()} · {cand.finish.toUpperCase()} · {cand.language.toUpperCase()} · {cand.locationName}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>)}
    <Button secondary label="Close" disabled={busy} onPress={onClose} />
  </View>;
}

function ReviewCard({review,demo,userId,locations,defaults,onSubmitted,onSaved,onCancel,onMessage}: {
  review: Review; demo: boolean; userId: string | null; locations: Location[]; defaults: LastUsedDraft | null;
  onSubmitted(scan: ConfirmedScan): void; onSaved(draft: LastUsedDraft): void; onCancel(): void; onMessage(text: string): void;
}) {
  const {printing,submitted} = review;
  // A recovered pending scan (`submitted`) always wins — those values were
  // already written to SecureStore and possibly already sent, so a retry
  // must resubmit exactly what was decided before, never a fresher default.
  // Absent that, `defaults` (the last card's choices) pre-fills a fresh
  // review; absent both, the chips start unselected as before.
  const [finish,setFinish] = useState<Finish | undefined>(submitted?.draft.finish ?? defaults?.finish);
  const [condition,setCondition] = useState(submitted?.draft.condition ?? defaults?.condition);
  const [language,setLanguage] = useState(submitted?.draft.language ?? defaults?.language ?? '');
  // Deliberately NOT defaulted from `defaults` — see LastUsedDraft's comment.
  const [quantity,setQuantity] = useState(String(submitted?.draft.quantity ?? 1));
  const [location,setLocation] = useState<string | null>(submitted?.draft.location_id ?? defaults?.location_id ?? null);
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
      const lastUsed: LastUsedDraft = {finish:draft.finish, condition:draft.condition, language:draft.language, location_id:draft.location_id};
      if (demo) { onSaved(lastUsed); return; }
      if (!confirm || !userId) throw new Error('Sign in to Upkeep before saving.');
      const scan = submitted ?? {operationId:review.operationId,draft};
      // Persist BEFORE writing. A crash or lost response can be retried with the same primary key.
      await SecureStore.setItemAsync(pendingKey(userId), JSON.stringify(scan));
      onSubmitted(scan);
      await confirm.save(scan, printing);
      await SecureStore.deleteItemAsync(pendingKey(userId));
      onSaved(lastUsed);
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
  row:{flexDirection:'row',gap:10},
  // A card with nothing sleeved needs to visibly recede — the "what do I
  // still need to sleeve" glance this feature exists for depends on the
  // unsleeved rows reading as muted at a glance, not just via smaller text.
  deckRowUnsleeved:{opacity:0.55,borderStyle:'dashed'},deckRowUnsleevedText:{color:'#8c692c'},deckRowSleevedText:{color:'#2f6b45',fontWeight:'700'},
});
