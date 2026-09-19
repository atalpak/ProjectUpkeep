import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { makeStyles } from '../preferences';
import { PAGES, type PageId } from '../navigation';
import { space, text, type } from '../theme';

/** Stand-in for pages that exist on the web but are not built in the app yet. */
export function PlaceholderScreen({ page }: { page: PageId }) {
  const styles = useStyles();
  return (
    <View style={styles.page}>
      <Image source={require('../mort/assets/mort_idle_02.png')} style={styles.mort} resizeMode="contain" />
      <Text style={styles.title}>{PAGES[page].title}</Text>
      <Text style={styles.body}>This page is coming to the app soon. It works on the web in the meantime.</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  mort: { width: 140, height: 140 },
  title: { ...type.title, color: text.primary },
  body: { ...type.body, color: text.secondary, textAlign: 'center' },
}));
