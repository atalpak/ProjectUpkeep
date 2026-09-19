import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { makeStyles } from '../preferences';
import { accent, border, radius, scrim, space, state as stateColor, surface, text, type } from '../theme';
import { Button } from './ui';

// The published catalog is ~40 MB; used only to draw a believable bar when the server does not say a size.
const ESTIMATED_BYTES = 40_000_000;
const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/**
 * The card-database window, in three situations that share one look:
 *  - no database at all (a build without the bundled snapshot): a yes/no ask
 *    with the reason it matters, since the scanner matches nothing without it;
 *  - a newer database is available: "New cards are available. Update?";
 *  - a download or unpack is running, whatever started it: a progress bar,
 *    and the window closes itself when it finishes.
 *
 * "Not now" for the first case lasts the session (the scanner is useless
 * without the database, so it asks again next launch). "Later" for an update
 * is remembered per version (see catalogUpdates.ts), so it is not nagging.
 */
export function CatalogDownloadModal() {
  const styles = useStyles();
  const app = useApp();
  const [declined, setDeclined] = useState(false);
  const [updateLater, setUpdateLater] = useState(false);
  const [ready, setReady] = useState(false);
  const wasBusy = useRef(false);

  // busy -> idle with no error means the download finished: show "ready" for a beat, then close.
  useEffect(() => {
    if (app.catalogBusy) { wasBusy.current = true; return; }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (app.catalogError) return;
    setReady(true);
    const timer = setTimeout(() => setReady(false), 900);
    return () => clearTimeout(timer);
  }, [app.catalogBusy, app.catalogError]);

  const idle = !app.catalogBusy && !app.catalogError && !ready;
  const asking = app.demo && !declined && idle;
  const update = app.catalogUpdate;
  const offeringUpdate = !!update && !app.demo && !updateLater && idle;
  const visible = app.catalogBusy || !!app.catalogError || ready || asking || offeringUpdate;
  if (!visible) return null;

  const progress = app.catalogProgress;
  const downloading = progress?.phase === 'downloading' ? progress : null;
  const fraction = downloading ? Math.min(downloading.received / (downloading.total ?? ESTIMATED_BYTES), downloading.total ? 1 : 0.97) : 1;

  function notNow() { setDeclined(true); setUpdateLater(true); app.clearCatalogError(); }
  function later() { setUpdateLater(true); app.dismissCatalogUpdate(); }

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={() => { if (!app.catalogBusy) notNow(); }}>
      <View style={styles.scrim}>
        <View style={styles.card} accessibilityViewIsModal>
          {ready ? (
            <>
              <Ionicons name="checkmark-circle" size={44} color={stateColor.success} />
              <Text style={styles.title}>Card database ready</Text>
            </>
          ) : app.catalogError ? (
            <>
              <Ionicons name="cloud-offline-outline" size={40} color={text.secondary} />
              <Text style={styles.title}>The download didn’t finish</Text>
              <Text style={styles.body}>{app.catalogError}</Text>
              <Button label="Try again" onPress={() => void app.syncCatalog()} />
              <Button secondary label="Not now" onPress={notNow} />
            </>
          ) : app.catalogBusy ? (
            <>
              <Text style={styles.title}>{progress?.phase === 'preparing' ? 'Getting it ready…' : 'Downloading the card database'}</Text>
              <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}>
                <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
              </View>
              {progress?.phase === 'preparing'
                ? <View style={styles.row}><ActivityIndicator color={text.secondary} /><Text style={styles.small}>Almost there. This can take a few seconds.</Text></View>
                : <Text style={styles.small}>{downloading ? `${mb(downloading.received)} of ${downloading.total ? mb(downloading.total) : '~' + mb(ESTIMATED_BYTES)} MB` : ''}</Text>}
              <Text style={styles.small}>Keep the app open until it finishes.</Text>
            </>
          ) : offeringUpdate && update ? (
            <>
              <Ionicons name="sparkles-outline" size={40} color={text.primary} />
              <Text style={styles.title}>New cards are available</Text>
              <Text style={styles.body}>
                A newer card database is ready. It adds recently released cards and sets, so scanning and search can recognize them.
              </Text>
              <Text style={styles.small}>{update.bytes ? `About ${Math.round(update.bytes / 1_000_000)} MB. Wi-Fi is best.` : 'Wi-Fi is best.'}</Text>
              <Button label="Update" onPress={() => void app.syncCatalog()} />
              <Button secondary label="Later" onPress={later} />
            </>
          ) : (
            <>
              <Ionicons name="albums-outline" size={40} color={text.primary} />
              <Text style={styles.title}>Download the card database?</Text>
              <Text style={styles.body}>
                Upkeep recognizes the cards you scan by matching them against a copy of the Magic card database kept on your phone.
              </Text>
              <View style={styles.reasons}>
                <Text style={styles.reason}>• Without it, the scanner can’t tell what card you’re holding.</Text>
                <Text style={styles.reason}>• Once it’s here, scanning is fast and works with no signal.</Text>
                <Text style={styles.reason}>• It’s about 40 MB, so Wi-Fi is best, and you only do this once.</Text>
              </View>
              <Button label="Download (40 MB)" onPress={() => void app.syncCatalog()} />
              <Button secondary label="Not now" onPress={notNow} />
              <Text style={styles.small}>You can also download it later from Settings.</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: scrim, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  card: { width: '100%', maxWidth: 380, gap: space.md, alignItems: 'stretch', padding: space.xxl, borderRadius: radius.xl, backgroundColor: surface.canvas, borderWidth: 1, borderColor: border.hairline },
  title: { ...type.title, color: text.primary, textAlign: 'center' },
  body: { ...type.body, color: text.primary, textAlign: 'center' },
  reasons: { gap: space.sm, paddingVertical: space.xs },
  reason: { ...type.bodySm, color: text.secondary },
  small: { ...type.bodySm, color: text.secondary, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  track: { height: 12, borderRadius: 6, backgroundColor: surface.sunken, overflow: 'hidden', borderWidth: 1, borderColor: border.hairline },
  fill: { height: '100%', backgroundColor: accent.DEFAULT },
}));
