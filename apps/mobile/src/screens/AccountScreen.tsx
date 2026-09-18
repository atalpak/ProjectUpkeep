import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { Button } from '../components/ui';
import { space, surface, text, type as typeTokens } from '../theme';

/**
 * Owner decision: Account is a real 4th tab, not a header button — this is
 * the always-visible sign-out block that used to sit at the top of every
 * screen in App.tsx, moved here wholesale. Dense/utility surface per the
 * brand doc's frequency guidance (§27), so no Mort.
 */
export function AccountScreen() {
  const { userId, disabled, signOut } = useApp();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.section}>Account</Text>
      <View style={styles.card}>
        <Text style={styles.body}>{userId ? 'Connected to Upkeep' : 'Not signed in'}</Text>
        <Button label="Sign out" secondary disabled={disabled} onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  section: { ...typeTokens.title, color: text.primary },
  body: { fontSize: 13, lineHeight: 21, color: text.secondary },
  card: { padding: space.lg, backgroundColor: surface.raised, borderRadius: 16, gap: space.md },
});
