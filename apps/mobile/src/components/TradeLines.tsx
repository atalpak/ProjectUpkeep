import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';
import type { TradeLine } from '../trades';

/** One side of a trade: a titled list of what moves. */
export function TradeLines({ title, lines }: { title: string; lines: TradeLine[] }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{title}</Text>
      {lines.length === 0 && <Text style={styles.sub}>Nothing</Text>}
      {lines.map(l => (
        <View key={l.id} style={styles.row}>
          {l.imageSmall ? <Image source={{ uri: l.imageSmall }} style={styles.thumb} /> : <View style={styles.thumb} />}
          <View style={styles.grow}>
            <Text style={styles.name}>{l.quantity}× {l.name}</Text>
            <Text style={styles.sub}>{l.setCode ? `${l.setCode.toUpperCase()} · #${l.collectorNumber}` : ''}{l.finish && l.finish !== 'nonfoil' ? `${l.setCode ? ' · ' : ''}${l.finish}` : ''}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  group: { gap: space.sm },
  heading: { ...type.title, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  grow: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  thumb: { width: 42, height: 58, borderRadius: radius.sm / 2, backgroundColor: surface.sunken },
  name: { ...type.body, color: text.primary },
}));
