import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetchUnreadCount, onUnreadChanged } from '../notifications';

/**
 * The unread-notification count for the header and menu badges. Refreshes when
 * the user changes, when the app returns to the foreground, when the visible
 * page changes (`refreshOn`) and when the inbox marks itself read. There is no
 * polling and no push -- a new alert shows up the next time the app is looked at.
 */
export function useUnreadCount(userId: string | null, refreshOn: unknown): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!userId) { setCount(0); return; }
    void fetchUnreadCount(userId).then(setCount);
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh, refreshOn]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    const off = onUnreadChanged(refresh);
    return () => { sub.remove(); off(); };
  }, [refresh]);

  return count;
}
