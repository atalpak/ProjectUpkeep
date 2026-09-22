import { backend } from './backend';

// Friends: the trade circle. The rules (who may request, accept, remove, and
// which of a friend's cards are visible) live in the database policies from
// migration 9, not here -- this layer only turns errors into sentences. Reads
// of another person's rows are deliberate and rely on those policies: a
// friend's copies are only returned when they sit in a container that friend
// marked tradable, and their wish list only to a friend.

export type FriendEdge = {
  /** The friendships row id. */
  id: string;
  otherId: string;
  username: string;
  /** friend = accepted; incoming = they asked you; outgoing = you asked them. */
  relation: 'friend' | 'incoming' | 'outgoing';
};

async function usernames(ids: string[]): Promise<Map<string, string>> {
  if (!backend || ids.length === 0) return new Map();
  const { data } = await backend.from('profiles').select('id,username').in('id', ids);
  return new Map((data ?? []).map(p => [p.id as string, p.username as string]));
}

export async function fetchFriendEdges(userId: string): Promise<FriendEdge[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('friendships')
    .select('id,requester_id,addressee_id,status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const names = await usernames(rows.map(r => (r.requester_id === userId ? r.addressee_id : r.requester_id) as string));
  return rows.map(r => {
    const otherId = (r.requester_id === userId ? r.addressee_id : r.requester_id) as string;
    const relation: FriendEdge['relation'] = r.status === 'accepted' ? 'friend' : r.requester_id === userId ? 'outgoing' : 'incoming';
    return { id: r.id as string, otherId, username: names.get(otherId) ?? 'someone', relation };
  });
}

export type PersonResult = { id: string; username: string };

/** Finds people by username. Profiles are readable by any signed-in user (a row holds a username and nothing else). */
export async function searchPeople(userId: string, term: string): Promise<PersonResult[]> {
  if (!backend || term.trim().length < 2) return [];
  // Strip the characters that mean something to a LIKE pattern or PostgREST's filter grammar.
  const safe = term.trim().replace(/[%_,()*\\]/g, '');
  if (safe.length < 2) return [];
  const { data, error } = await backend.from('profiles').select('id,username').ilike('username', `%${safe}%`).neq('id', userId).order('username').limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).map(p => ({ id: p.id as string, username: p.username as string }));
}

export async function sendFriendRequest(userId: string, addresseeId: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('friendships').insert({ requester_id: userId, addressee_id: addresseeId, status: 'pending' });
  if (error) {
    // The unique index is on the ordered pair, so this fires whether they already asked you or you already asked them.
    if (error.code === '23505' || error.message.includes('duplicate key')) throw new Error('There is already a request between you two.');
    throw new Error(error.message);
  }
}

/** Only the addressee can do this; the policy enforces it. */
export async function acceptFriendRequest(id: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('friendships').update({ status: 'accepted' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Declines a request, cancels one you sent, or unfriends. All a delete: no tombstone is kept. */
export async function removeFriendship(id: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { error } = await backend.from('friendships').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type FriendCard = { id: string; cardId: string; name: string; setCode: string; collectorNumber: string; quantity: number; finish?: string; condition?: string; imageSmall: string | null; layout: string | null };

type CardJoin = { name: string; set_code: string; collector_number: string; image_uri_small: string | null; layout: string | null } | null;

/** A friend's cards that are open for trade. RLS returns nothing outside their tradable containers. */
export async function fetchFriendTradables(friendId: string): Promise<FriendCard[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('card_instances')
    .select('id,card_id,quantity,finish,condition,cards(name,set_code,collector_number,image_uri_small,layout)')
    .eq('owner_user_id', friendId)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(r => {
    const c = r.cards as unknown as CardJoin;
    return c ? [{ id: r.id as string, cardId: r.card_id as string, name: c.name, setCode: c.set_code, collectorNumber: c.collector_number, quantity: r.quantity as number, finish: r.finish as string, condition: r.condition as string, imageSmall: c.image_uri_small, layout: c.layout }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** A friend's wish list (readable to friends by policy). */
export async function fetchFriendWants(friendId: string): Promise<FriendCard[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('want_list')
    .select('id,card_id,quantity,cards(name,set_code,collector_number,image_uri_small,layout)')
    .eq('user_id', friendId)
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap(r => {
    const c = r.cards as unknown as CardJoin;
    return c ? [{ id: r.id as string, cardId: r.card_id as string, name: c.name, setCode: c.set_code, collectorNumber: c.collector_number, quantity: r.quantity as number, imageSmall: c.image_uri_small, layout: c.layout }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
