import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { border, radius, space, surface, text, type } from '../theme';
import { makeStyles } from '../preferences';
import { Chevron, Tappable } from './ui';

/**
 * One row of the flat, hairline-bordered lists this app uses for decks,
 * collection entries and pickers — the mobile equivalent of
 * src/components/ui.tsx's ListRow on the web side, simplified to the one
 * shape every call site here actually needs (a thumbnail, a title, a
 * subtitle, and an optional tap target with a trailing chevron).
 */
export function ListRow({ title, subtitle, imageUri, onPress, disabled, dimmed }: {
  title: string; subtitle?: string; imageUri?: string | null; onPress?(): void; disabled?: boolean; dimmed?: boolean;
}) {
  const styles = useStyles();
  const content = (
    <View style={[styles.row, dimmed && styles.rowDimmed]}>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.thumbnail} /> : null}
      <View style={styles.grow}>
        <Text style={[styles.title, dimmed && styles.titleDimmed]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {onPress ? <Chevron /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Tappable feedback="dim" accessibilityRole="button" disabled={disabled} onPress={onPress}>
      {content}
    </Tappable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, padding: space.md, borderRadius: radius.md },
  rowDimmed: { opacity: 0.55, borderStyle: 'dashed' },
  grow: { flex: 1 },
  title: { ...type.rowTitle, color: text.primary },
  titleDimmed: { color: text.secondary },
  subtitle: { ...type.bodySm, color: text.secondary },
  thumbnail: { width: 45, height: 63, borderRadius: radius.thumb },
}));
