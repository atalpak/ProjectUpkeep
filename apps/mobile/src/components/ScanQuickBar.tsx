import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES } from '@upkeep/scan-core';
import { Choices } from './ui';
import { accent, border, fontFamily, radius, space, surface, text as textColor } from '../theme';
import { makeStyles } from '../preferences';

/**
 * The scanner's quick options — modeled on ManaBox's own quick-controls row:
 * a language chip and a quantity stepper. These set the defaults the NEXT read uses; they never touch a card
 * already staged (that's the footer's F/+1 controls for the last card,
 * or the edit controls in the session-review screen).
 *
 * As of the 2026-09-18 live-scanner rebuild this is shown from the top bar's
 * settings icon rather than pinned above the preview: a full-bleed camera
 * with a result sheet at the bottom has no room for a permanent second bar,
 * and these are set-once-per-session options, not per-card ones.
 */
export function ScanQuickBar({
  language, onSelectLanguage, quantity, onChangeQuantity,
}: {
  language: string | undefined;
  onSelectLanguage(language: string): void;
  quantity: number;
  onChangeQuantity(quantity: number): void;
}) {
  const styles = useStyles();
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);

  return (
    <View>
      {languagePickerOpen && (
        <View style={styles.languagePicker}>
          <Choices
            values={[...LANGUAGES]}
            selected={language}
            onSelect={v => { onSelectLanguage(v); setLanguagePickerOpen(false); }}
          />
        </View>
      )}
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: languagePickerOpen }}
          onPress={() => setLanguagePickerOpen(v => !v)}
          style={[styles.chip, languagePickerOpen && styles.chipLocked]}
        >
          <Text style={styles.chipText}>{(language ?? LANGUAGES[0]).toUpperCase()}</Text>
        </Pressable>
        <View style={styles.stepper}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fewer copies per scan" onPress={() => onChangeQuantity(Math.max(1, quantity - 1))} style={styles.stepperButton}>
            <Text style={styles.stepperText}>−</Text>
          </Pressable>
          <Text style={styles.stepperValue}>{quantity}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="More copies per scan" onPress={() => onChangeQuantity(Math.min(99, quantity + 1))} style={styles.stepperButton}>
            <Text style={styles.stepperText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, borderRadius: radius.md, padding: space.sm },
  languagePicker: { marginBottom: space.sm, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, borderRadius: radius.md, padding: space.sm },
  chip: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised },
  chipLocked: { backgroundColor: accent.soft, borderColor: accent.DEFAULT },
  chipText: { fontSize: 13, fontFamily: fontFamily.bodySemiBold, fontWeight: '600', color: textColor.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  stepperButton: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised, alignItems: 'center', justifyContent: 'center' },
  stepperText: { fontSize: 16, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary },
  stepperValue: { fontSize: 14, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary, minWidth: 20, textAlign: 'center' },
}));
