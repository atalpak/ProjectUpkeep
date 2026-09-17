import { backend } from './backend';

// Read-only "browse what I own" query, kept in its own module (rather than
// inline in App.tsx) because the same view, column list and row shape are
// the obvious starting point for the decks and social screens that come
// after this phase — see the mobile impact map this phase followed.
//
// This queries public.collection_entries (migration 24), not card_instances
// directly: PostgREST cannot ORDER BY a column on an embedded table, and the
// view flattens card_instances + cards + locations specifically so sorting
// and range-paging a collection works as a single query instead of a
// fetch-everything-then-sort-in-JS pass. See that migration's header for the
// full reasoning.

export const PAGE_SIZE = 50;

export type CollectionEntry = {
  id: string;
  card_id: string;
  quantity: number;
  card_name: string;
  card_set_code: string;
  card_collector_number: string;
  card_rarity: string;
  card_image_uri_small: string | null;
  card_image_uri: string | null;
  condition: string;
  finish: string;
  language: string;
  location_id: string | null;
  location_name: string | null;
  location_type: string | null;
};

const COLUMNS = [
  'id', 'card_id', 'quantity',
  'card_name', 'card_set_code', 'card_collector_number', 'card_rarity',
  'card_image_uri_small', 'card_image_uri',
  'condition', 'finish', 'language',
  'location_id', 'location_name', 'location_type',
  // Not rendered — PostgREST allows filtering on a column outside the
  // select projection, so this is only here to keep the shape self-evident
  // when read alongside the .eq below. See that comment for why it's mandatory.
  'owner_user_id',
].join(',');

export type CollectionPage = {
  entries: CollectionEntry[];
  // Only present on the first page's response (see fetchCollectionPage),
  // because requesting an exact count on every page re-scans the whole
  // result set for a number the caller already has after page one.
  totalEntries: number | null;
};

// Thrown separately from a plain Error so the screen can tell "your session
// is no longer valid" apart from "you have no cards" — collection_entries is
// granted to `authenticated` only, so an expired/invalid session comes back
// as a permission error (PostgREST code 42501 / a thrown auth error), not as
// zero rows. Those are different situations for the user and must not look
// the same.
export class CollectionAuthError extends Error {}

export async function fetchCollectionPage(userId: string, page: number): Promise<CollectionPage> {
  if (!backend) throw new Error('Not connected.');
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = backend
    .from('collection_entries')
    .select(COLUMNS, page === 0 ? { count: 'exact' } : undefined)
    // Mandatory: collection_entries runs with security_invoker, so RLS on
    // card_instances still applies underneath it — including migration 9's
    // policy that legitimately makes a friend's tradable binder readable.
    // Without this explicit filter this query would return a friend's cards
    // mixed in with the signed-in user's own, the same bug category phase 1
    // fixed in the locations query above.
    .eq('owner_user_id', userId)
    // card_name is the primary sort; id is a stable tiebreak so that paging
    // by range never skips or repeats a row when two cards share a name.
    .order('card_name', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) {
    // PostgREST returns 42501 (insufficient_privilege) for a query an
    // expired/invalid session is no longer allowed to run; surface that
    // distinctly rather than letting the caller read it as "no cards".
    if (error.code === '42501' || error.code === 'PGRST301') throw new CollectionAuthError(error.message);
    throw new Error(error.message);
  }
  return { entries: (data ?? []) as unknown as CollectionEntry[], totalEntries: page === 0 ? (count ?? 0) : null };
}
