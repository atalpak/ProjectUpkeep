import { backend } from './backend';

export type NotificationPreferences = { trade_offers: boolean; trade_updates: boolean; friendships: boolean };
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { trade_offers: true, trade_updates: true, friendships: true };
const FIELDS = 'trade_offers,trade_updates,friendships';

export async function loadNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  if (!backend) throw new Error('Sign in to manage alerts.');
  const { data, error } = await backend.from('notification_preferences').select(FIELDS).eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Could not load alert preferences. Check your connection and try again.');
  return data ?? { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/** Save only the changed category, preserving changes made on another device. */
export async function saveNotificationPreference(userId: string, category: keyof NotificationPreferences, enabled: boolean): Promise<void> {
  if (!backend) throw new Error('Sign in to manage alerts.');
  const { error } = await backend.from('notification_preferences').upsert({ user_id: userId, [category]: enabled }, { onConflict: 'user_id', defaultToNull: false });
  if (error) throw new Error('Could not save your preference. Your previous setting has been restored.');
}
