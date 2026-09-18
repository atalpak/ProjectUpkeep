import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createCollectionWriter, createMoveWriter, type CollectionStore, type StackAdditionInput, type StackAdditionResult, type MoveStore, type StackMoveInput, type StackMoveResult, type Condition, type Finish } from '@upkeep/scan-core';

// Persisted auth (phase 1b) needs a storage object with getItem/setItem/removeItem.
// expo-secure-store is already a dependency and already used for the pending-scan
// key in App.tsx, so it is the natural place for the session too, rather than
// pulling in AsyncStorage as well.
//
// The historical concern with SecureStore is a value-size ceiling — Android
// Keystore-backed storage used to cap entries around 2KB, well under a Supabase
// session (access token + refresh token + user object can run 1-3KB). That ceiling
// came from an older RSA-wrapping encryptor, where the plaintext had to fit in one
// RSA block. This is no longer how it works: node_modules/expo-secure-store's
// current Android implementation (AESEncryptor.kt) stores an AES-256-GCM key in
// the Keystore and uses it to encrypt the value directly — the value length no
// longer depends on any asymmetric block size. The package's own CHANGELOG records
// the matching iOS change ("[iOS] Remove byte limit warning"). So storing the
// session blob as one SecureStore entry, unchunked, is safe on this SDK version —
// no AsyncStorage fallback or chunking needed.
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const backend = url && key ? createClient(url, key, {
  // Sign-in now survives an app restart. Recovering a pending scan after restart
  // still requires an explicit tap — see the recovery effect in App.tsx — so
  // persisting the session does not turn into automatic background replay.
  auth: { persistSession: true, storage: secureStoreAdapter, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init?.signal?.aborted) controller.abort();
    init?.signal?.addEventListener('abort', abort);
    const timer = setTimeout(abort, 15_000);
    try { return await fetch(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); init?.signal?.removeEventListener('abort', abort); }
  } },
}) : null;

// Phase 3a: the scanner now merges into an existing stack the same way the web
// app does (packages/upkeep-domain's stacking policy), applied atomically
// through migration 36's apply_stack_addition RPC — see
// packages/scan-core/src/writer.ts for why that function, not a plain
// insert/update from here, is what makes this safe under a second writer.
async function currentUserId(): Promise<string | null> {
  const { data, error } = await backend!.auth.getUser();
  if (error) throw error;
  return data.user?.id ?? null;
}

const store: CollectionStore = {
  currentUserId,

  // Explicit owner filter, not just RLS: RLS alone would also return a
  // friend's tradable-binder rows sharing this stack key (migration 9), which
  // would merge a scan into a stack that was never this account's — the same
  // discipline .claude/rules/data-access.md requires of
  // src/lib/collection/queries.ts on the web side.
  async findCandidates({ cardId, condition, finish, language, locationId }) {
    const owner = await currentUserId();
    if (!owner) throw new Error('Sign in to save to your collection.');
    let query = backend!.from('card_instances')
      .select('id,quantity,notes')
      .eq('owner_user_id', owner)
      .eq('card_id', cardId)
      .eq('condition', condition)
      .eq('finish', finish)
      .eq('language', language);
    query = locationId === null ? query.is('location_id', null) : query.eq('location_id', locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async applyStackAddition(input: StackAdditionInput): Promise<StackAdditionResult> {
    const { data, error } = await backend!.rpc('apply_stack_addition', {
      p_operation_id: input.operationId,
      p_target_instance_id: input.targetInstanceId,
      p_card_id: input.cardId,
      p_condition: input.condition,
      p_finish: input.finish,
      p_language: input.language,
      p_location_id: input.locationId,
      p_quantity: input.quantity,
      p_notes: input.notes,
    });
    if (error) throw error;
    // apply_stack_addition RETURNS TABLE (...), so PostgREST hands back an
    // array of one row rather than a single object.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('apply_stack_addition returned no result.');
    return { instanceId: row.result_instance_id, quantity: row.result_quantity, replayed: row.replayed };
  },
};

export const writer = backend ? createCollectionWriter(store) : null;

/**
 * Phase 4b/4c: sleeve-into-deck / unsleeve-from-deck, applied atomically
 * through migration 38's apply_stack_move — see packages/scan-core/src/move.ts
 * for why a move needs a different atomic function (and a different retry
 * shape) than a plain addition.
 */
const moveStore: MoveStore = {
  // Explicit owner filter, not just RLS — same reasoning as `store.
  // findCandidates` above: RLS alone would also return a friend's tradable-
  // binder rows sharing this stack key (migration 9), which would merge a
  // move into a stack that was never this account's.
  async findDestinationCandidates({ cardId, condition, finish, language, locationId }) {
    const owner = await currentUserId();
    if (!owner) throw new Error('Sign in to move cards in your collection.');
    let query = backend!.from('card_instances')
      .select('id,quantity,notes')
      .eq('owner_user_id', owner)
      .eq('card_id', cardId)
      .eq('condition', condition)
      .eq('finish', finish)
      .eq('language', language);
    query = locationId === null ? query.is('location_id', null) : query.eq('location_id', locationId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async applyStackMove(input: StackMoveInput): Promise<StackMoveResult> {
    const { data, error } = await backend!.rpc('apply_stack_move', {
      p_operation_id: input.operationId,
      p_source_instance_id: input.sourceInstanceId,
      p_quantity: input.quantity,
      p_destination_location_id: input.destinationLocationId,
      p_destination_target_instance_id: input.destinationTargetInstanceId,
    });
    if (error) throw error;
    // apply_stack_move RETURNS TABLE (...), same PostgREST array-of-one shape
    // as apply_stack_addition.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('apply_stack_move returned no result.');
    return { instanceId: row.result_instance_id, quantity: row.result_quantity, replayed: row.replayed };
  },
};

export const moveWriter = backend ? createMoveWriter(moveStore) : null;
