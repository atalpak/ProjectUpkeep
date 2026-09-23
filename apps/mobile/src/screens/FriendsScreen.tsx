import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../AppProvider';
import { Button, Notice } from '../components/ui';
import { PageTitle } from '../components/PageTitle';
import { errorMessage } from '../errors';
import { acceptFriendRequest, fetchFriendEdges, removeFriendship, searchPeople, sendFriendRequest, type FriendEdge, type PersonResult } from '../friends';
import { PAGES, type FriendsStackParamList } from '../navigation';
import { makeStyles } from '../preferences';
import { border, radius, space, surface, text, type } from '../theme';

/**
 * Your trade circle: find people by username, answer requests, and open a
 * friend to see what they have open for trade and what they want. Trades
 * themselves are their own page.
 */
export function FriendsScreen({ navigation }: NativeStackScreenProps<FriendsStackParamList, 'FriendList'>) {
  const styles = useStyles();
  const { userId } = useApp();
  const focused = useIsFocused();
  const [edges, setEdges] = useState<FriendEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const e = await fetchFriendEdges(userId);
      if (alive.current) { setEdges(e); setError(''); }
    } catch (err) { if (alive.current) setError(errorMessage(err)); }
    finally { if (alive.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { if (focused) void load(); }, [focused, load]);

  // Debounced username search.
  useEffect(() => {
    if (!userId) return;
    const id = ++requestId.current;
    if (query.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPeople(userId, query).then(
        r => { if (id === requestId.current) { setResults(r); setSearching(false); } },
        e => { if (id === requestId.current) { setError(errorMessage(e)); setSearching(false); } },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [query, userId]);

  async function act(key: string, work: () => Promise<void>, done?: string) {
    if (busyId) return;
    setBusyId(key); setError(''); setNotice('');
    try { await work(); if (done) setNotice(done); await load(); } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  const friends = edges.filter(e => e.relation === 'friend');
  const incoming = edges.filter(e => e.relation === 'incoming');
  const outgoing = edges.filter(e => e.relation === 'outgoing');
  const relationOf = (id: string) => edges.find(e => e.otherId === id)?.relation ?? null;

  function confirmRemove(e: FriendEdge, title: string, message: string, action: string) {
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: () => void act(e.id, () => removeFriendship(e.id)) }]);
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <PageTitle>{PAGES.Friends.title}</PageTitle>
      {!!error && <Notice>{error}</Notice>}
      {!!notice && <Notice>{notice}</Notice>}

      <View style={styles.field}>
        <Ionicons name="search" size={20} color={text.secondary} />
        <TextInput accessibilityLabel="Find people by username" style={styles.input} value={query} onChangeText={setQuery} placeholder="Find people by username" placeholderTextColor={text.secondary} autoCapitalize="none" autoCorrect={false} />
        {!!query && <Pressable accessibilityLabel="Clear" hitSlop={8} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={text.secondary} /></Pressable>}
      </View>

      {query.trim().length >= 2 && (
        <View style={styles.group}>
          {searching && results.length === 0 && <Text style={styles.sub}>Searching…</Text>}
          {!searching && results.length === 0 && <Text style={styles.sub}>No one found with that name.</Text>}
          {results.map(p => {
            const rel = relationOf(p.id);
            return (
              <View key={p.id} style={styles.row}>
                <Text style={[styles.name, styles.grow]}>{p.username}</Text>
                {rel === 'friend' ? <Text style={styles.sub}>Friends</Text>
                  : rel === 'outgoing' ? <Text style={styles.sub}>Request sent</Text>
                  : rel === 'incoming' ? <Text style={styles.sub}>Asked you. See below.</Text>
                  : <Button secondary label={busyId === p.id ? 'Sending…' : 'Add'} disabled={!!busyId} onPress={() => void act(p.id, () => sendFriendRequest(userId!, p.id), `Request sent to ${p.username}.`)} />}
              </View>
            );
          })}
        </View>
      )}

      {incoming.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.heading}>Requests for you</Text>
          {incoming.map(e => (
            <View key={e.id} style={styles.row}>
              <Text style={[styles.name, styles.grow]}>{e.username}</Text>
              <Button label={busyId === e.id ? '…' : 'Accept'} disabled={!!busyId} onPress={() => void act(e.id, () => acceptFriendRequest(e.id), `You and ${e.username} are now friends.`)} />
              <Button secondary label="Decline" disabled={!!busyId} onPress={() => void act(e.id, () => removeFriendship(e.id))} />
            </View>
          ))}
        </View>
      )}

      {outgoing.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.heading}>Waiting on</Text>
          {outgoing.map(e => (
            <View key={e.id} style={styles.row}>
              <Text style={[styles.name, styles.grow]}>{e.username}</Text>
              <Button secondary label="Cancel" disabled={!!busyId} onPress={() => confirmRemove(e, 'Cancel this request?', `Your request to ${e.username} is withdrawn.`, 'Cancel request')} />
            </View>
          ))}
        </View>
      )}

      <View style={styles.group}>
        <Text style={styles.heading}>Friends{friends.length ? ` (${friends.length})` : ''}</Text>
        {loading && <Text style={styles.sub}>Loading…</Text>}
        {!loading && friends.length === 0 && <Text style={styles.sub}>No friends yet. Search for a username above to send a request.</Text>}
        {friends.map(e => (
          <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.username}, profile`} onPress={() => navigation.navigate('FriendProfile', { friendId: e.otherId, username: e.username, friendshipId: e.id })} style={styles.row}>
            <Ionicons name="person-circle-outline" size={28} color={text.secondary} />
            <Text style={[styles.name, styles.grow]}>{e.username}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xl, paddingBottom: 40, gap: space.lg },
  group: { gap: space.sm },
  heading: { ...type.title, color: text.primary },
  sub: { ...type.bodySm, color: text.secondary },
  grow: { flex: 1 },
  chevron: { fontSize: 22, color: text.secondary },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  input: { flex: 1, ...type.body, color: text.primary, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline, minHeight: 56 },
  name: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
}));
