import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { makeStyles } from '../preferences';
import { text, type } from '../theme';

/**
 * A root screen's own title, now that the unified AppHeader shows Mort
 * instead of a title bar (see docs/briefs/MOBILE_UI_REFINEMENT_BRIEF.md Priority 1).
 * Sits at the top of the content area in the app's existing display type --
 * the same 26pt Cinzel weight DeckDetailScreen's commander banner already
 * uses, so this reads as the same visual language rather than a new one.
 *
 * Detail screens that already carry their own hero/banner title (DeckDetail's
 * commander banner; TradeDetail/TradeBuilder's own heading) do not use this --
 * a page never shows two titles at once.
 */
export function PageTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const styles = useStyles();
  return <Text accessibilityRole="header" style={[styles.title, style]}>{children}</Text>;
}

const useStyles = makeStyles(() => StyleSheet.create({
  title: { ...type.display, color: text.primary },
}));
