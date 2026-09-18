import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ConfirmScan, ScanPipeline, CONDITIONS, LANGUAGES, scanBand, validateDraft, type Candidate, type ConfirmedScan, type Finish } from '@upkeep/scan-core';
import { readText, visionAvailable } from '@upkeep/vision';
import { writer } from '../backend';
import { useApp, type LastUsedDraft, type Review } from '../AppProvider';
import { errorMessage } from '../errors';
import { pendingKey } from '../storage';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useMort } from '../mort/controller';
import { MortStage } from '../mort/MortStage';
import { Button, Choices } from '../components/ui';
import { accent, border, radius, space, state as stateTokens, surface, text, type as typeTokens } from '../theme';

/**
 * The scan tab. Camera/permission/capture state, the manual-search picker
 * and the printing candidates all stay local here — none of it is needed by
 * another tab. ReviewCard stays an in-screen component rather than a route,
 * per the design spec: a submitted-but-recovering save must not be casually
 * dismissable with a swipe-back gesture, which promoting it to a stack
 * screen would hand it for free.
 */
export function ScanScreen() {
  const app = useApp();
  const mort = useMort();
  const reducedMotion = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [filterSetCode, setFilterSetCode] = useState('');
  const [filterCollectorNumber, setFilterCollectorNumber] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matchTotal, setMatchTotal] = useState(0);
  // Transient "Filed." beat shown right after a save, per the design spec --
  // see the onSaved handler below for its timing.
  const [justFiled, setJustFiled] = useState(false);
  const camera = useRef<CameraView>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const pipeline = useMemo(() => new ScanPipeline(app.index, { readText }), [app.index]);
  const band = candidates.length ? scanBand(candidates) : null;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const stopCamera = useRef(() => {
    controller.current?.abort();
    setCameraOpen(false);
    setReady(false);
  });
  useEffect(() => {
    app.registerCameraStop(stopCamera.current);
    return () => app.registerCameraStop(null);
  }, [app]);
  // A tab navigator keeps every screen mounted rather than unmounting it on
  // switch, so without this the camera sensor would stay open while the
  // user browses Collection/Decks — the AppState handler alone only covers
  // the app going to the background, not a same-app tab switch.
  useFocusEffect(React.useCallback(() => {
    return () => stopCamera.current();
  }, []));

  async function capture() {
    if (!camera.current || !ready || lock.current) return;
    lock.current = true; app.setBusy(true); app.setMessage('');
    const task = new AbortController(); controller.current = task;
    let uri: string | undefined;
    mort.react('look');
    mort.react('scan'); // fires immediately after 'look' -- see controller.ts: the second call always wins a race.
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.85, exif: false });
      uri = photo?.uri;
      if (!uri || task.signal.aborted) return;
      const result = await pipeline.scan(uri, task.signal);
      if (!alive.current || task.signal.aborted) return;
      // The result renders in the same tick it resolves -- never gated on an
      // animation duration (see pipeline.ts: SCAN has no fixed length).
      setCandidates(result.candidates); setCameraOpen(false); setReady(false);
      const resultBand = scanBand(result.candidates);
      if (resultBand === 'confident') { mort.react('scan_success'); app.setMessage('Choose the exact printing below. A name match alone cannot identify its set or finish.'); }
      else if (resultBand === 'uncertain') { mort.react('scan_uncertain'); app.setMessage('Choose the exact printing below. A name match alone cannot identify its set or finish.'); }
      else { mort.react('scan_uncertain'); app.setMessage('No confident name match. Try better lighting, or search by name.'); }
    } catch (e) {
      // No Mort at all on an actual error -- pipeline throw, permission
      // denial, camera mount failure, friendlyDbMessage output. `annoyed`
      // stays reserved for a future genuinely Mort-appropriate moment (per
      // the brand doc's error-handling rule, §28), not this catch block.
      if (alive.current && !task.signal.aborted) app.setMessage(errorMessage(e));
    } finally {
      if (uri) { try { new File(uri).delete(); } catch { /* OS cache cleanup is a fallback */ } }
      lock.current = false;
      if (alive.current) app.setBusy(false);
    }
  }

  async function openCamera() {
    if (app.disabled) return;
    try {
      const p = permission?.granted ? permission : await requestPermission();
      if (!p.granted) { app.setMessage('Camera access is off. Enable it in Settings, or search by name.'); return; }
      setReady(false); setCameraOpen(true);
    } catch (e) { app.setMessage(errorMessage(e)); }
  }

  function runSearch(name: string, setCode: string, collectorNumber: string) {
    const { results, total } = app.index.searchWithTotal(name, {}, {
      ...(setCode.trim() ? { setCode: setCode.trim() } : {}),
      ...(collectorNumber.trim() ? { collectorNumber: collectorNumber.trim() } : {}),
    });
    setCandidates(results); setMatchTotal(total);
  }

  function clearSearch() {
    setCandidates([]); setMatchTotal(0); setQuery(''); setFilterSetCode(''); setFilterCollectorNumber('');
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {app.review ? (
        <ReviewCard
          key={app.review.operationId}
          review={app.review}
          demo={app.demo}
          userId={app.userId}
          locations={app.locations}
          defaults={app.lastUsedDraft}
          onSubmitted={scan => app.setReview({ ...app.review!, submitted: scan })}
          onMessage={app.setMessage}
          onCancel={() => app.setReview(null)}
          onSaved={draft => {
            app.setLastUsedDraft(draft);
            app.addRecent(`${app.review!.printing.name} · ${app.review!.printing.setCode.toUpperCase()} #${app.review!.printing.collectorNumber}`);
            app.setReview(null); clearSearch();
            mort.react('file');
            setJustFiled(true);
            // Hold roughly matches the controller's own 'file' tier (800ms)
            // plus a ~300ms fade back to idle -- see mort/controller.ts's
            // HOLD_MS. Never blocks anything: "Added this session" already
            // gives the persistent record, this is only the transient beat.
            setTimeout(() => setJustFiled(false), 1100);
            app.setMessage(app.demo ? 'Added to this demo session.' : 'Saved to your Upkeep collection.');
          }}
        />
      ) : (
        <>
          {justFiled && (
            <View style={styles.resultBand}>
              <MortStage size="S" />
              <Text style={styles.mortLine}>Filed.</Text>
            </View>
          )}
          <View style={styles.cameraPanel}>
            {cameraOpen && app.active ? (
              <CameraLive
                camera={camera}
                busy={app.busy}
                reducedMotion={reducedMotion}
                onReady={() => setReady(true)}
                onMountError={() => { setReady(false); setCameraOpen(false); app.setMessage('Camera could not start. Use manual search or retry.'); }}
              />
            ) : (
              <IdleCameraState onOpenCamera={() => void openCamera()} disabled={app.disabled} />
            )}
          </View>
          {cameraOpen && (
            <>
              <Button label={app.busy ? 'Reading card…' : 'Capture card'} disabled={app.disabled || !ready} onPress={() => void capture()} />
              <Button label="Close camera" secondary onPress={stopCamera.current} />
            </>
          )}
          {permission && !permission.granted && !permission.canAskAgain && (
            <Button secondary label="Open camera settings" onPress={() => void Linking.openSettings()} />
          )}
          <Text style={styles.section}>Or find a card by name</Text>
          <TextInput
            accessibilityLabel="Card name"
            style={styles.input}
            placeholder={app.demo ? 'Try Lightning Bolt or Sol Ring' : 'Enter the full card name'}
            value={query}
            editable={!app.disabled}
            onChangeText={t => { setQuery(t); runSearch(t, filterSetCode, filterCollectorNumber); }}
          />
          <View style={styles.row}>
            <TextInput accessibilityLabel="Set code" style={[styles.input, styles.grow]} placeholder="Set (optional)" autoCapitalize="characters" value={filterSetCode} editable={!app.disabled} onChangeText={t => { setFilterSetCode(t); runSearch(query, t, filterCollectorNumber); }} />
            <TextInput accessibilityLabel="Collector number" style={[styles.input, styles.grow]} placeholder="# (optional)" value={filterCollectorNumber} editable={!app.disabled} onChangeText={t => { setFilterCollectorNumber(t); runSearch(query, filterSetCode, t); }} />
          </View>
          {matchTotal > candidates.length && <Text style={styles.body}>Showing {candidates.length} of {matchTotal} matched — narrow with a set code or collector number above.</Text>}
          {!!candidates.length && (
            <View style={styles.resultBand}>
              <MortStage size="S" />
              <Text style={styles.mortLine}>
                {band === 'confident' ? 'Found it.' : 'Again.'}
              </Text>
            </View>
          )}
          {candidates.map((c, i) => {
            const elevated = band === 'confident' && i === 0;
            return (
              <Pressable
                key={c.printing.id}
                disabled={app.disabled}
                style={[styles.result, elevated && styles.resultElevated]}
                onPress={() => { setCameraOpen(false); setReady(false); app.setReview({ printing: c.printing, operationId: Crypto.randomUUID() }); }}
              >
                {c.printing.imageUri && <Image source={{ uri: c.printing.imageUri }} style={styles.thumbnail} />}
                <View style={styles.grow}>
                  <View style={styles.resultTitleRow}>
                    <Text style={styles.resultTitle}>{c.printing.name}</Text>
                    {elevated && <Text style={styles.elevatedBadge}>✓ best match</Text>}
                  </View>
                  <Text style={styles.body}>{c.printing.setName ?? c.printing.setCode.toUpperCase()} · #{c.printing.collectorNumber} · {c.printing.language.toUpperCase()}</Text>
                  <Text style={styles.hint}>{c.evidence === 'printing' ? 'Name + set / number match' : 'Verify set and collector number'}</Text>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            );
          })}
          {query.length > 1 && !candidates.length && (
            <View style={styles.resultBand}>
              <MortStage size="S" />
              <Text style={styles.body}>No match in this catalog. Check the name or refresh the catalog.</Text>
            </View>
          )}
          <View style={styles.divider} />
          <Text style={styles.section}>Ready wherever you play</Text>
          <Text style={styles.body}>{app.index.bundle.printings.length.toLocaleString()} printings · {app.index.bundle.version}. Matching works offline; collection saves need a connection.</Text>
          <Button secondary label={app.catalogBusy ? 'Updating catalog…' : 'Refresh offline catalog'} disabled={app.catalogBusy || lock.current || !!app.review} onPress={() => void app.syncCatalog()} />
          {!!app.recent.length && (
            <>
              <Text style={styles.section}>{app.demo ? 'Demo session' : 'Added this session'}</Text>
              {app.recent.map((r, i) => <Text key={i} style={styles.body}>✓ {r}</Text>)}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function IdleCameraState({ onOpenCamera, disabled }: { onOpenCamera(): void; disabled: boolean }) {
  return (
    <View style={styles.cameraPlaceholder}>
      <MortStage size="M" />
      <Text style={styles.cameraTitle}>Every card has a place.</Text>
      <Text style={styles.cameraCaption}>{visionAvailable ? 'Text recognition stays on your phone.' : 'Use a development build for on-device OCR.'}</Text>
      <Button label="Open camera" disabled={disabled} onPress={onOpenCamera} />
    </View>
  );
}

/**
 * Live camera preview. Mort is deliberately NOT rendered here — the brand
 * doc's "feel special, not omnipresent" rule and the "scanner performance
 * always wins" rule both argue against it (see the developer handoff §24,
 * §27), and this was a deliberate call in the design pass.
 */
function CameraLive({ camera, busy, reducedMotion, onReady, onMountError }: {
  camera: React.RefObject<CameraView | null>; busy: boolean; reducedMotion: boolean;
  onReady(): void; onMountError(): void;
}) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!busy || reducedMotion) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reducedMotion, sweep]);

  return (
    <>
      <CameraView ref={camera} style={styles.camera} facing="back" onCameraReady={onReady} onMountError={onMountError} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.scrimBar, styles.scrimTop]} />
        <View style={[styles.scrimBar, styles.scrimBottom]} />
        <View style={[styles.scrimBar, styles.scrimLeft]} />
        <View style={[styles.scrimBar, styles.scrimRight]} />
        <View style={styles.reticle}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
          {busy && !reducedMotion && (
            <Animated.View
              style={[
                styles.sweep,
                { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, 220] }) }] },
              ]}
            />
          )}
        </View>
        <Text style={styles.guideText}>Fill the frame with one card</Text>
      </View>
    </>
  );
}

/**
 * A recovered pending scan (`submitted`) always wins over `defaults` — those
 * values were already written to SecureStore and possibly already sent, so
 * a retry must resubmit exactly what was decided before, never a fresher
 * default. Absent both, chips start unselected. No Mort here — a dense form
 * is not a good context per the brand doc.
 */
function ReviewCard({ review, demo, userId, locations, defaults, onSubmitted, onSaved, onCancel, onMessage }: {
  review: Review; demo: boolean; userId: string | null; locations: { id: string; name: string }[]; defaults: LastUsedDraft | null;
  onSubmitted(scan: ConfirmedScan): void; onSaved(draft: LastUsedDraft): void; onCancel(): void; onMessage(text: string): void;
}) {
  const { printing, submitted } = review;
  const [finish, setFinish] = useState<Finish | undefined>(submitted?.draft.finish ?? defaults?.finish);
  const [condition, setCondition] = useState(submitted?.draft.condition ?? defaults?.condition);
  const [language, setLanguage] = useState(submitted?.draft.language ?? defaults?.language ?? '');
  const [quantity, setQuantity] = useState(String(submitted?.draft.quantity ?? 1));
  const [location, setLocation] = useState<string | null>(submitted?.draft.location_id ?? defaults?.location_id ?? null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const confirm = useMemo(() => writer ? new ConfirmScan(writer) : null, []);
  const locked = !!submitted || saving;

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const draft = validateDraft({ card_id: printing.id, finish: finish!, condition: condition!, language,
        quantity: /^\d+$/.test(quantity) ? Number(quantity) : NaN, location_id: location, notes: null }, printing);
      const lastUsed: LastUsedDraft = { finish: draft.finish, condition: draft.condition, language: draft.language, location_id: draft.location_id };
      if (demo) { onSaved(lastUsed); return; }
      if (!confirm || !userId) throw new Error('Sign in to Upkeep before saving.');
      const scan = submitted ?? { operationId: review.operationId, draft };
      await SecureStore.setItemAsync(pendingKey(userId), JSON.stringify(scan));
      onSubmitted(scan);
      await confirm.save(scan, printing);
      await SecureStore.deleteItemAsync(pendingKey(userId));
      onSaved(lastUsed);
    } catch (e) { onMessage(errorMessage(e)); } finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <View style={styles.review}>
      <Text style={styles.eyebrow}>CONFIRM YOUR CARD</Text>
      <Text style={styles.section}>{printing.name}</Text>
      {printing.imageUri && <Image source={{ uri: printing.imageUri }} style={styles.cardImage} resizeMode="contain" />}
      <Text style={styles.body}>{printing.setCode.toUpperCase()} · #{printing.collectorNumber}</Text>
      <Text style={styles.label}>Finish</Text><Choices values={printing.finishes} selected={finish} disabled={locked} onSelect={v => setFinish(v as Finish)} />
      <Text style={styles.label}>Condition</Text><Choices values={[...CONDITIONS]} selected={condition} disabled={locked} onSelect={v => setCondition(v as typeof CONDITIONS[number])} />
      <Text style={styles.label}>Language on your card</Text><Choices values={[...LANGUAGES]} selected={language} disabled={locked} onSelect={setLanguage} />
      <Text style={styles.label}>Quantity</Text><TextInput accessibilityLabel="Quantity" style={styles.input} value={quantity} onChangeText={setQuantity} editable={!locked} keyboardType="number-pad" />
      <Text style={styles.label}>Destination</Text>
      <Choices values={['', ...locations.map(l => l.id)]} selected={location ?? ''} disabled={locked} onSelect={v => setLocation(v || null)} labels={Object.fromEntries([['', 'Unsorted'], ...locations.map(l => [l.id, l.name])])} />
      {submitted && <Text style={styles.notice}>These details are locked for a safe retry. Retrying can never add this card twice, whether it lands in a new row or merges into a stack you already have.</Text>}
      <Button label={saving ? 'Saving…' : demo ? 'Add to demo session' : submitted ? 'Retry / verify save' : 'Add to collection'} disabled={saving || !finish || !condition || !language || (!demo && !userId)} onPress={() => void save()} />
      {!submitted && <Button secondary label="Choose another printing" disabled={saving} onPress={onCancel} />}
    </View>
  );
}

const CORNER = 22;
const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  section: { ...typeTokens.title, color: text.primary, marginTop: space.sm },
  body: { ...typeTokens.body, fontSize: 13, lineHeight: 21, color: text.secondary },
  eyebrow: { ...typeTokens.eyebrow, color: text.secondary },
  label: { fontSize: 13, fontWeight: '700', color: text.primary, marginTop: space.sm },
  notice: { backgroundColor: surface.sunken, padding: space.lg, borderRadius: radius.md, color: text.primary, fontSize: 13, lineHeight: 21 },
  input: { backgroundColor: surface.raised, borderColor: border.hairline, borderWidth: 1, borderRadius: radius.sm + 2, padding: 14, color: text.primary, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
  cameraPanel: { height: 310, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: surface.inverse },
  camera: { flex: 1 },
  cameraPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  cameraTitle: { color: text.inverse, fontSize: 21, textAlign: 'center', fontWeight: '600' },
  cameraCaption: { color: border.strong, fontSize: 13, textAlign: 'center' },
  scrimBar: { position: 'absolute', backgroundColor: 'rgba(31,31,31,0.55)' },
  scrimTop: { top: 0, left: 0, right: 0, height: '8%' },
  scrimBottom: { bottom: 0, left: 0, right: 0, height: '8%' },
  scrimLeft: { top: '8%', bottom: '8%', left: 0, width: '19%' },
  scrimRight: { top: '8%', bottom: '8%', right: 0, width: '19%' },
  reticle: { position: 'absolute', top: '8%', bottom: '8%', left: '19%', right: '19%', overflow: 'hidden' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: accent.DEFAULT },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.sm },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.sm },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: radius.sm },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: radius.sm },
  sweep: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: accent.DEFAULT, opacity: 0.8 },
  guideText: { position: 'absolute', bottom: '4%', left: 0, right: 0, color: text.inverse, backgroundColor: surface.inverse, fontSize: 10, textAlign: 'center', padding: 6 },
  resultBand: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mortLine: { ...typeTokens.mort, color: text.secondary },
  result: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, padding: 14, borderRadius: radius.md },
  resultElevated: { backgroundColor: accent.soft, borderColor: accent.DEFAULT },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  resultTitle: { fontSize: 16, fontWeight: '600', color: text.primary },
  elevatedBadge: { fontSize: 11, fontWeight: '700', color: stateTokens.success },
  hint: { fontSize: 11, color: text.secondary, marginTop: 5 },
  thumbnail: { width: 45, height: 63, borderRadius: 3 },
  arrow: { fontSize: 28, color: text.secondary },
  review: { gap: space.md, backgroundColor: surface.raised, padding: 18, borderRadius: radius.lg },
  cardImage: { height: 260, width: '100%' },
  divider: { height: 1, backgroundColor: border.hairline, marginVertical: space.sm },
});
