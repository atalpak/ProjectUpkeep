import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatScanEntry, formatScanLog, summarizeScanEntry } from '@upkeep/scan-core';
import { Button, Chevron, GroupRow, ListGroup, Notice, Tappable } from '../components/ui';
import { makeStyles } from '../preferences';
import { clearScanLog, getScanLog, loadScanLog, scanLogEnabled, subscribeScanLog } from '../scanLog';
import { border, radius, space, surface, text, type as typeTokens } from '../theme';

/**
 * The "Scan log" page behind Settings -> Scan diagnostics: the last ~30 reads and
 * the evidence for each, newest first. A modal rather than a route so it needs no
 * navigation changes and cannot disturb the tab tree.
 *
 * "Copy" opens the system share sheet with the whole log as plain text, whose
 * first action is Copy. A direct clipboard write would need `expo-clipboard`, a
 * native module, and therefore a rebuild of the app; the share sheet is core
 * React Native and works in the build the owner already has installed.
 */
export function ScanLogScreen({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const entries = useSyncExternalStore(subscribeScanLog, getScanLog);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { if (visible) void loadScanLog(); }, [visible]);
  useEffect(() => { if (!visible) { setOpen(null); setConfirmClear(false); } }, [visible]);

  const newestFirst = [...entries].reverse();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Scan log</Text>
          <Tappable accessibilityRole="button" accessibilityLabel="Close scan log" style={styles.close} onPress={onClose}><Text style={styles.closeLabel}>Done</Text></Tappable>
        </View>
        {!scanLogEnabled() && <Notice>Scan diagnostics is off, so new scans are not being recorded. Turn it on in Settings.</Notice>}
        <View style={styles.actions}>
          <View style={styles.action}><Button label="Copy" disabled={entries.length === 0} onPress={() => { void Share.share({ message: formatScanLog(entries) }).catch(() => {}); }} /></View>
          <View style={styles.action}>
            {confirmClear
              ? <Button secondary label="Tap again to clear" onPress={() => { clearScanLog(); setConfirmClear(false); setOpen(null); }} />
              : <Button secondary label="Clear" disabled={entries.length === 0} onPress={() => setConfirmClear(true)} />}
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.list}>
          {newestFirst.length === 0
            ? <Text style={styles.empty}>Nothing recorded yet. With diagnostics on, scan a card and it appears here.</Text>
            : (
              <ListGroup>
                {newestFirst.map((e, i) => {
                  const expanded = open === e.id;
                  return (
                    <View key={e.id}>
                      <GroupRow accessibilityLabel={`${summarizeScanEntry(e)}. ${expanded ? 'Collapse' : 'Expand'}`} onPress={() => setOpen(expanded ? null : e.id)}>
                        <Text style={styles.rowText} numberOfLines={expanded ? undefined : 2}>{summarizeScanEntry(e)}</Text>
                        <Chevron />
                      </GroupRow>
                      {expanded && <Text selectable style={styles.detail}>{formatScanEntry(e, i + 1)}</Text>}
                    </View>
                  );
                })}
              </ListGroup>
            )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { flex: 1, backgroundColor: surface.canvas, paddingHorizontal: space.xl, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typeTokens.title, color: text.primary },
  close: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  closeLabel: { ...typeTokens.body, color: text.primary },
  actions: { flexDirection: 'row', gap: space.md },
  action: { flex: 1 },
  list: { paddingBottom: space.xl },
  empty: { ...typeTokens.bodySm, color: text.secondary },
  rowText: { flex: 1, ...typeTokens.bodySm, color: text.primary },
  detail: { ...typeTokens.bodySm, color: text.secondary, fontFamily: 'Courier', padding: space.md, backgroundColor: surface.raised, borderRadius: radius.md, borderWidth: 1, borderColor: border.hairline },
}));
