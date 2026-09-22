import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';
import type { TradeLine } from '../trades';
import { FlipThumb } from './FlipThumb';

/** One side of a trade: a titled list of what moves. */
export function TradeLines({ title, lines }: { title: string; lines: TradeLine[] }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{title}</Text>
      {lines.length === 0 && <Text style={styles.sub}>Nothing</Text>}
      {lines.map(l => (
        <View key={l.id} style={styles.row}>
          <FlipThumb card={{ name: l.name, layout: l.layout, imageSmall: l.imageSmall }} thumbStyle={styles.thumb}>
            {name => (
              <View style={styles.grow}>
                <Text style={styles.name}>{l.quantity}× {name}</Text>
                <Text style={styles.sub}>{l.setCode ? `${l.setCode.toUpperCase()} · #${l.collectorNumber}` : ''}{l.finish && l.finish !== 'nonfoil' ? `${l.setCode ? ' · ' : ''}${l.finish}` : ''}</Text>
              </View>
            )}
          </FlipThumb>
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
