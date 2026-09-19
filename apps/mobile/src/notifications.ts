import type { NotificationType } from '@upkeep/domain';
import { backend } from './backend';

// The in-app inbox. Rows are written only by database triggers (migrations 14
// and 22) -- there is no insert policy -- so this layer can read, mark read, and
// nothing else. The type CHECK, widened by migration 22, admits the five trade
// types plus friend_request and friend_accepted, which is exactly the set
// @upkeep/domain's NotificationType names.
//
// No push: this is a pull-based inbox, refreshed when the app is opened or
// brought to the foreground. Every query names the signed-in user explicitly.

export type AppNotification = {
  id: string;
  type: NotificationType;
  actor: string;
  tradeId: string | null;
  friendshipId: string | null;
  read: boolean;
  createdAt: string;
};

// Small pub/sub so the header badge hears about a mark-read without the inbox
// screen having to know who is listening.
const listeners = new Set<() => void>();
export function onUnreadChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A head count -- no rows come back. Zero on any failure: a badge must never be the thing that errors. */
export async function fetchUnreadCount(userId: string): Promise<number> {
  if (!backend) return 0;
  const { count, error } = await backend.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

export async function fetchNotifications(userId: string, limit = 50): Promise<AppNotification[]> {
  if (!backend) return [];
  const { data, error } = await backend
    .from('notifications')
    .select('id,actor_id,type,trade_id,friendship_id,read_at,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const actorIds = [...new Set(rows.map(r => r.actor_id as string | null).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: people } = await backend.from('profiles').select('id,username').in('id', actorIds);
    for (const p of people ?? []) names.set(p.id as string, p.username as string);
  }
  return rows.map(r => ({
    id: r.id as string,
    type: r.type as NotificationType,
    // actor_id goes null when that person deletes their account.
    actor: (r.actor_id ? names.get(r.actor_id as string) : undefined) ?? 'Someone',
    tradeId: (r.trade_id as string | null) ?? null,
    friendshipId: (r.friendship_id as string | null) ?? null,
    read: r.read_at !== null,
    createdAt: r.created_at as string,
  }));
}

/** Opening the inbox is the acknowledgement, as on the web. Only sets read_at, the one thing the policy allows. */
export async function markAllRead(userId: string): Promise<void> {
  if (!backend) return;
  const { error } = await backend.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
  if (error) throw new Error(error.message);
  listeners.forEach(fn => fn());
}
