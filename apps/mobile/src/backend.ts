import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { createCollectionWriter, type SavedRow } from '@upkeep/scan-core';

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
export const writer = backend ? createCollectionWriter({
  async currentUserId() {
    const { data, error } = await backend!.auth.getUser();
    if (error) throw error;
    return data.user?.id ?? null;
  },
  async insert(row) {
    const { error } = await backend!.from('card_instances').insert(row);
    if (error) throw error;
  },
  async find(id) {
    const { data, error } = await backend!.from('card_instances')
      .select('id,owner_user_id,card_id,condition,finish,language,quantity,location_id,notes').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as SavedRow | null;
  },
}) : null;
