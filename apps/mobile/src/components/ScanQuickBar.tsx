import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES, type Finish } from '@upkeep/scan-core';
import { Choices } from './ui';
import { accent, border, fontFamily, radius, space, surface, text as textColor } from '../theme';
import { makeStyles } from '../preferences';

/**
 * The scanner's quick options — modeled on ManaBox's own quick-controls row:
 * a foil/normal toggle, a set-lock chip, a language chip and a quantity
 * stepper. These set the defaults the NEXT read uses; they never touch a card
 * already staged (that's the sheet's FOIL/+1 controls for the card just
 * scanned, or the pencil edit in the session-review screen).
 *
 * As of the 2026-09-18 live-scanner rebuild this is shown from the top bar's
 * settings icon rather than pinned above the preview: a full-bleed camera
 * with a result sheet at the bottom has no room for a permanent second bar,
 * and these are set-once-per-session options, not per-card ones.
 */
export function ScanQuickBar({
  finish, onSelectFinish, language, onSelectLanguage, lockedSetCode, canLock, onToggleLock, quantity, onChangeQuantity,
}: {
  finish: Finish | undefined;
  onSelectFinish(finish: Finish): void;
  language: string | undefined;
  onSelectLanguage(language: string): void;
  lockedSetCode: string | null;
  canLock: boolean;
  onToggleLock(): void;
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
        <Choices
          values={['nonfoil', 'foil']}
          selected={finish}
          onSelect={v => onSelectFinish(v as Finish)}
          labels={{ nonfoil: 'Normal', foil: 'Foil' }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canLock && !lockedSetCode, selected: !!lockedSetCode }}
          disabled={!canLock && !lockedSetCode}
          onPress={onToggleLock}
          style={[styles.chip, !!lockedSetCode && styles.chipLocked, !canLock && !lockedSetCode && styles.chipDisabled]}
        >
          <Text style={styles.chipText}>{lockedSetCode ? lockedSetCode.toUpperCase() : 'Lock set'}</Text>
        </Pressable>
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
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, fontFamily: fontFamily.bodySemiBold, fontWeight: '600', color: textColor.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  stepperButton: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: border.hairline, backgroundColor: surface.raised, alignItems: 'center', justifyContent: 'center' },
  stepperText: { fontSize: 16, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary },
  stepperValue: { fontSize: 14, fontFamily: fontFamily.bodySemiBold, fontWeight: '700', color: textColor.primary, minWidth: 20, textAlign: 'center' },
}));
