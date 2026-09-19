/**
 * The three-screen welcome shown once after a first sign-in, and again on
 * request from Settings ("Show the welcome again"). Skippable at every step.
 *
 * It only describes what the app does today: finding a card, scanning, and
 * friends/trades as the reason the first two matter. Nothing here links to a
 * page that is still a placeholder (see BUILT in navigation.ts).
 *
 * A Modal rather than a route, for the same reason the search overlay is not
 * one: it must sit above the tab navigator without touching its tree
 * position (see RootShell's comment).
 */
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { makeStyles } from '../preferences';
import { space, surface, text, type } from '../theme';
import { Button } from './ui';

const STEPS = [
  { image: require('../mort/assets/mort_file.png'), title: 'Where is my card?', body: 'Upkeep remembers which binder, box or deck each copy actually sits in, so you can find it in seconds.' },
  { image: require('../mort/assets/mort_scan.png'), title: 'Scan to add', body: 'Point your camera at a card and it is recognised for you. Check the list, then add it to your collection.' },
  { image: require('../mort/assets/mort_idle.png'), title: 'Friends and trades', body: 'Add friends to see who has the cards you want, and which of yours they are looking for.' },
] as const;

export function WelcomeWalkthrough({ visible, onDone }: { visible: boolean; onDone(): void }) {
  const styles = useStyles();
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const current = STEPS[step]!;
  function finish() { setStep(0); onDone(); }
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={finish}>
      <SafeAreaView style={styles.page}>
        <View style={styles.skipRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Skip the welcome" onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>
        <View style={styles.body}>
          <Image source={current.image} style={styles.mort} accessibilityIgnoresInvertColors />
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.copy}>{current.body}</Text>
        </View>
        <View style={styles.footer}>
          <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((s, i) => <View key={s.title} style={[styles.dot, i === step && styles.dotOn]} />)}
          </View>
          <Button label={last ? 'Get started' : 'Next'} onPress={() => (last ? finish() : setStep(step + 1))} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { flex: 1, backgroundColor: surface.canvas, padding: space.xxl },
  skipRow: { alignItems: 'flex-end' },
  skip: { ...type.body, color: text.secondary },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  mort: { width: 180, height: 180, resizeMode: 'contain' },
  title: { ...type.display, color: text.primary, textAlign: 'center' },
  copy: { ...type.body, color: text.secondary, textAlign: 'center' },
  footer: { gap: space.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: surface.sunken },
  dotOn: { backgroundColor: text.secondary },
}));
