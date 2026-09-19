/**
 * Catches a render-time crash below it and shows a calm "try again" screen
 * instead of a white screen. React only supports this as a class component.
 *
 * Two are mounted (App.tsx): one around the whole signed-in shell, and a
 * separate one around the Scan tab, so a scanner crash leaves the header,
 * tab bar and every other page working. "Try again" remounts the subtree
 * from scratch, which also runs the unmount cleanups (ScanScreen clears
 * `scannerLive` that way, so the chrome comes back).
 *
 * It sits inside PreferencesProvider so the fallback can use themed styles.
 * A crash in the providers themselves is not caught here, by design: there is
 * nothing to fall back to without them.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { reportError } from '../errors';
import { makeStyles } from '../preferences';
import { space, surface, text, type } from '../theme';
import { Button } from './ui';

type Props = {
  /** Short stable label for the crash report, e.g. "screen:scan". */
  context: string;
  /** Replaces the default headline, e.g. "The scanner ran into a problem." */
  title?: string;
  children: React.ReactNode;
};

export class ErrorBoundary extends React.Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) { reportError(error, this.props.context); }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Fallback title={this.props.title} onRetry={() => this.setState({ failed: false })} />;
  }
}

function Fallback({ title, onRetry }: { title?: string; onRetry(): void }) {
  const styles = useStyles();
  return (
    <View style={styles.page} accessibilityRole="alert">
      <Text style={styles.title}>{title ?? 'Something went wrong'}</Text>
      <Text style={styles.body}>Your collection is safe. Give it another go, and if it keeps happening, close and reopen the app.</Text>
      <Button label="Try again" onPress={onRetry} />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: space.lg, padding: space.xxl, backgroundColor: surface.canvas },
  title: { ...type.title, color: text.primary },
  body: { ...type.body, color: text.secondary },
}));
