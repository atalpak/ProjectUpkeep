import { expiryFromNow, isExpired, type CounterSourceItem } from '@upkeep/domain';
import { backend } from './backend';
import type { FriendCard } from './friends';
import { TOS_ENFORCEMENT_MESSAGE, fetchTosStatus, tradingAllowed } from './tos';

// Trades, mirrored from src/lib/social/queries.ts (hydrateTrades) and
// src/app/(app)/trades/actions.ts. The rules -- who may propose, who may close,
// what a closed trade may become -- live in migrations 9 and 12, not here.
//
// Two things are deliberately NOT done from this client:
//   - Completing a trade. `card_instances` RLS forbids any client from changing
//     owner_user_id, so acceptance is `supabase.rpc('accept_trade')` and nothing
//     else (CLAUDE.md constraint 5). There is no code path here that writes to
//     card_instances at all.
//   - Loosening anything. Decline/cancel/counter are the same ordinary writes
//     the web makes, bounded by "trades: close own" (status may only become
//     declined / cancelled / countered).
//
// Every read that answers "which trades are mine" filters on the signed-in
// user explicitly. RLS would return only my trades anyway, but the discipline
// in .claude/rules/mobile.md is that own-data queries do not lean on the floor.

export type TradeStatus = 'proposed' | 'countered' | 'accepted' | 'declined' | 'completed' | 'cancelled';

export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  proposed: 'Proposed',
  countered: 'Countered',
  accepted: 'Accepted',
  declined: 'Declined',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export type TradeLine = {
  id: string;
  /** Null once the copy was deleted (migration 25); the snapshot still names the card. */
  instanceId: string | null;
  direction: 'from_proposer' | 'from_recipient';
  quantity: number;
  finish: string | null;
  cardId: string | null;
  name: string;
  setCode: string;
  collectorNumber: string;
  imageSmall: string | null;
  layout: string | null;
};

export type Trade = {
  id: string;
  proposerId: string | null;
  recipientId: string | null;
  status: TradeStatus;
  expiresAt: string | null;
  createdAt: string;
  counteredFrom: string | null;
  iProposed: boolean;
  otherId: string | null;
  otherName: string;
  /** Open = still acceptable: proposed and not past its expiry. */
  open: boolean;
  expired: boolean;
  /** What the signed-in user gives up / gets, already flipped into their frame. */
  giving: TradeLine[];
  receiving: TradeLine[];
  /** Every line in the trade's own frame, for mirrorTradeForCounter. */
  items: TradeLine[];
};

type TradeRow = { id: string; proposer_id: string | null; recipient_id: string | null; status: string; expires_at: string | null; created_at: string; countered_from: string | null };
type ItemRow = { id: string; trade_id: string; card_instance_id: string | null; direction: string; quantity: number; card_id: string | null; finish: string | null };
type CardRow = { scryfall_id: string; name: string; set_code: string; collector_number: string; image_uri_small: string | null; layout: string | null };

const TRADE_COLUMNS = 'id,proposer_id,recipient_id,status,expires_at,created_at,countered_from';

async function hydrate(userId: string, rows: TradeRow[]): Promise<Trade[]> {
  if (!backend || rows.length === 0) return [];

  const peopleIds = [...new Set(rows.flatMap(t => [t.proposer_id, t.recipient_id]).filter((id): id is string => !!id))];
  const { data: people } = await backend.from('profiles').select('id,username').in('id', peopleIds);
  const names = new Map((people ?? []).map(p => [p.id as string, p.username as string]));

  const { data: itemData, error: itemError } = await backend
    .from('trade_items')
    .select('id,trade_id,card_instance_id,direction,quantity,card_id,finish')
    .in('trade_id', rows.map(t => t.id));
  if (itemError) throw new Error(itemError.message);
  const items = (itemData ?? []) as ItemRow[];

  // Identity comes from the snapshot card_id on the item (migration 23): it is
  // immutable and `cards` is world-readable, so it stays right even for a card
  // that has since changed hands.
  //
  // Older items may have no snapshot. For those ONLY, this reads the
  // card_instances row by id -- and that is deliberately not scoped to the
  // signed-in user's ownership: an item on the other side of a trade is a copy
  // *they* own, and RLS is what decides whether I may see it (an open trade, or
  // one I received). Anything RLS hides is simply absent and renders as
  // "a card". It is a lookup keyed by ids the trade itself names, not a browse.
  const needInstance = [...new Set(items.filter(i => !i.card_id && i.card_instance_id).map(i => i.card_instance_id as string))];
  const fallback = new Map<string, { card_id: string; finish: string }>();
  if (needInstance.length > 0) {
    const { data } = await backend.from('card_instances').select('id,card_id,finish').in('id', needInstance);
    for (const r of data ?? []) fallback.set(r.id as string, { card_id: r.card_id as string, finish: r.finish as string });
  }

  const cardIds = [...new Set(items.map(i => i.card_id ?? (i.card_instance_id ? fallback.get(i.card_instance_id)?.card_id : undefined)).filter((id): id is string => !!id))];
  const cards = new Map<string, CardRow>();
  if (cardIds.length > 0) {
    const { data } = await backend.from('cards').select('scryfall_id,name,set_code,collector_number,image_uri_small,layout').in('scryfall_id', cardIds);
    for (const c of (data ?? []) as CardRow[]) cards.set(c.scryfall_id, c);
  }

  const now = Date.now();
  return rows.map(t => {
    const iProposed = t.proposer_id === userId;
    const otherId = iProposed ? t.recipient_id : t.proposer_id;
    const status = t.status as TradeStatus;
    const expired = isExpired({ expires_at: t.expires_at, status }, now);
    const lines: TradeLine[] = items.filter(i => i.trade_id === t.id).map(i => {
      const fb = i.card_instance_id ? fallback.get(i.card_instance_id) : undefined;
      const cardId = i.card_id ?? fb?.card_id ?? null;
      const c = cardId ? cards.get(cardId) : undefined;
      return {
        id: i.id,
        instanceId: i.card_instance_id,
        direction: i.direction as TradeLine['direction'],
        quantity: i.quantity,
        finish: i.finish ?? fb?.finish ?? null,
        cardId,
        name: c?.name ?? 'a card',
        setCode: c?.set_code ?? '',
        collectorNumber: c?.collector_number ?? '',
        imageSmall: c?.image_uri_small ?? null,
        layout: c?.layout ?? null,
      };
    });
    const mineDirection: TradeLine['direction'] = iProposed ? 'from_proposer' : 'from_recipient';
    return {
      id: t.id,
      proposerId: t.proposer_id,
      recipientId: t.recipient_id,
      status,
      expiresAt: t.expires_at,
      createdAt: t.created_at,
      counteredFrom: t.countered_from,
      iProposed,
      otherId,
      otherName: (otherId ? names.get(otherId) : undefined) ?? 'someone',
      open: status === 'proposed' && !expired,
      expired: status === 'proposed' && expired,
      giving: lines.filter(l => l.direction === mineDirection),
      receiving: lines.filter(l => l.direction !== mineDirection),
      items: lines,
    };
  });
}

/** Every trade the user is part of, newest first. */
export async function fetchTrades(userId: string): Promise<Trade[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('trades')
    .select(TRADE_COLUMNS)
    .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return hydrate(userId, (data ?? []) as TradeRow[]);
}

export async function fetchTrade(userId: string, tradeId: string): Promise<Trade | null> {
  if (!backend) return null;
  const { data, error } = await backend
    .from('trades')
    .select(TRADE_COLUMNS)
    .eq('id', tradeId)
    .or(`proposer_id.eq.${userId},recipient_id.eq.${userId}`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [trade] = await hydrate(userId, [data as TradeRow]);
  return trade ?? null;
}

/**
 * Completes a trade. The database decides every failure (not the recipient,
 * already settled, a card that moved) so these are translations, not checks.
 * The one check made here is the terms gate, which the database cannot know.
 */
export async function acceptTrade(userId: string, tradeId: string): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  if (!tradingAllowed(await fetchTosStatus(userId))) throw new Error(TOS_ENFORCEMENT_MESSAGE);

  const { error } = await backend.rpc('accept_trade', { p_trade_id: tradeId });
  if (!error) return;
  const message = error.message ?? '';
  if (message.includes('no longer owned')) throw new Error('One of these cards has moved since the trade was proposed. Ask for a fresh offer.');
  if (message.includes('no longer exists')) throw new Error('A card in this trade has been deleted. Ask for a fresh offer.');
  if (message.includes('expired')) throw new Error('This offer has expired. Ask them to send it again.');
  if (message.includes('Only the recipient')) throw new Error('Only the person who received this offer can accept it.');
  throw new Error(message || 'That trade could not be completed.');
}

/** Declines an incoming offer, or cancels one you sent. Same RLS write the web makes. */
export async function closeTrade(tradeId: string, asProposer: boolean): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const { data, error } = await backend.from('trades').update({ status: asProposer ? 'cancelled' : 'declined' }).eq('id', tradeId).select('id');
  if (error) throw new Error(error.message);
  // A policy-filtered update is not an error, just zero rows: the trade was
  // settled or withdrawn while the screen was open.
  if (!data || data.length === 0) throw new Error('That offer is no longer open.');
}

/** Card-instance id -> quantity. */
export type Selection = Record<string, number>;

/** Your own copies that sit in a container you opened for trade -- what you can put on the table. */
export async function fetchMyTradables(userId: string): Promise<FriendCard[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('card_instances')
    .select('id,card_id,quantity,finish,condition,language,cards(name,set_code,collector_number,image_uri_small,layout),locations!location_id(is_tradable)')
    .eq('owner_user_id', userId)
    .limit(5000);
  if (error) throw new Error(error.message);
  type Join = { name: string; set_code: string; collector_number: string; image_uri_small: string | null; layout: string | null } | null;
  return (data ?? []).flatMap(r => {
    const loc = r.locations as unknown as { is_tradable?: boolean } | null;
    const c = r.cards as unknown as Join;
    if (!c || loc?.is_tradable !== true) return [];
    return [{ id: r.id as string, cardId: r.card_id as string, name: c.name, setCode: c.set_code, collectorNumber: c.collector_number, quantity: r.quantity as number, finish: r.finish as string, condition: r.condition as string, language: r.language as string, imageSmall: c.image_uri_small, layout: c.layout }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The shape mirrorTradeForCounter takes, from a trade in its own frame. */
export function counterSource(trade: Trade): CounterSourceItem[] {
  return trade.items.map(i => ({ direction: i.direction, quantity: i.quantity, instanceId: i.instanceId }));
}

/**
 * Sends a proposal, or a counter when `counterOf` is set. Mirrors proposeTrade:
 * the counter is validated before anything is written, the insert policy
 * re-checks friendship, a failed item insert removes the half-built trade, and
 * the original is only superseded (`countered`, terminal) once the new one is
 * whole.
 */
export async function proposeTrade(userId: string, input: { recipientId: string; offering: Selection; requesting: Selection; counterOf?: string }): Promise<void> {
  if (!backend) throw new Error('Not connected.');
  const entries = (sel: Selection, direction: 'from_proposer' | 'from_recipient') =>
    Object.entries(sel).filter(([, q]) => q > 0).map(([id, quantity]) => ({ card_instance_id: id, direction, quantity }));
  const offer = [...entries(input.offering, 'from_proposer'), ...entries(input.requesting, 'from_recipient')];
  if (offer.length === 0) throw new Error('Add at least one card to the trade.');

  if (!tradingAllowed(await fetchTosStatus(userId))) throw new Error(TOS_ENFORCEMENT_MESSAGE);

  const counterOf = input.counterOf ?? null;
  if (counterOf) {
    const { data: original, error } = await backend.from('trades').select('id,proposer_id,recipient_id,status').eq('id', counterOf).maybeSingle();
    if (error) throw new Error(error.message);
    if (!original || original.recipient_id !== userId || !['proposed', 'countered'].includes(original.status as string)) {
      throw new Error('That offer can’t be countered any more. It may have been accepted, declined, or withdrawn.');
    }
    if (original.proposer_id !== input.recipientId) throw new Error('A counter-offer has to go back to the person who made the original offer.');
  }

  const { data: trade, error: tradeError } = await backend
    .from('trades')
    .insert({ proposer_id: userId, recipient_id: input.recipientId, status: 'proposed', expires_at: expiryFromNow(), ...(counterOf ? { countered_from: counterOf } : {}) })
    .select('id')
    .single();
  if (tradeError) {
    if (tradeError.code === '42501' || tradeError.message.includes('row-level security')) throw new Error('You can only trade with people you are friends with.');
    throw new Error(tradeError.message);
  }

  const { error: itemsError } = await backend.from('trade_items').insert(offer.map(o => ({ trade_id: trade.id, ...o })));
  if (itemsError) {
    // Leave no half-built proposal behind; it is still ours and 'proposed', so the delete is permitted.
    await backend.from('trades').delete().eq('id', trade.id);
    throw new Error(`Could not add those cards: ${itemsError.message}`);
  }

  if (counterOf) {
    const { error: supersedeError } = await backend.from('trades').update({ status: 'countered' }).eq('id', counterOf);
    if (supersedeError) {
      await backend.from('trades').delete().eq('id', trade.id);
      throw new Error(`Could not replace the original offer: ${supersedeError.message}`);
    }
  }
}
