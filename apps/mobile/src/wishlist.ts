import { clampWantQuantity } from '@upkeep/domain';
import { backend } from './backend';

// Wish-list writes. Every one names the signed-in user explicitly: a friend's
// want_list rows are readable through RLS (migration 15) on purpose, so an
// unscoped write filter would be a hazard, not a convenience.
//
// The table keeps one row per user and printing (`want_list_user_card_key`,
// unique on (user_id, card_id)), which is what makes these safe to repeat.

/** Adds one to the wish list for this printing; a repeat adds to the quantity,
 *  as on the web.
 *
 *  A new row goes in as an upsert that ignores a conflict, so two taps racing
 *  past the "does it exist" read cannot insert twice: the loser is a no-op
 *  against the unique key instead of an error or a duplicate. (Two racing taps
 *  on an EXISTING row can still lose one increment; that is a read-modify-write
 *  and PostgREST has no atomic +1. It cannot duplicate or exceed the bounds.)
 *  The returned quantity is read back rather than assumed. */
export async function addToWishList(userId: string, cardId: string): Promise<{ quantity: number }> {
  if (!backend) throw new Error('Sign in to Upkeep before saving.');
  const { data: existing, error: readError } = await backend.from('want_list').select('id,quantity').eq('user_id', userId).eq('card_id', cardId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) {
    const quantity = clampWantQuantity((existing.quantity as number) + 1);
    const { error } = await backend.from('want_list').update({ quantity }).eq('id', existing.id as string).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { quantity };
  }
  const { error } = await backend.from('want_list').upsert({ user_id: userId, card_id: cardId, quantity: 1 }, { onConflict: 'user_id,card_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const { data: row, error: afterError } = await backend.from('want_list').select('quantity').eq('user_id', userId).eq('card_id', cardId).maybeSingle();
  if (afterError) throw new Error(afterError.message);
  return { quantity: (row?.quantity as number | undefined) ?? 1 };
}

/** Sets the wanted quantity of one entry, clamped to what the table allows. Returns the stored value. */
export async function setWantQuantity(userId: string, wantId: string, quantity: number): Promise<number> {
  if (!backend) throw new Error('Sign in to Upkeep before saving.');
  const next = clampWantQuantity(quantity);
  const { error } = await backend.from('want_list').update({ quantity: next }).eq('id', wantId).eq('user_id', userId);
  if (error) throw new Error(error.message);
  return next;
}
