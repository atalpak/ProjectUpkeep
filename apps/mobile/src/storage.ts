// SecureStore key builders for the two independent recovery records this app
// persists before a risky write — a pending scan and a pending sleeve/
// unsleeve. Own module so AppProvider, ScanScreen and DeckDetailScreen all
// derive the same key from a userId rather than each hand-rolling the
// template string.
export const pendingKey = (userId: string) => `upkeep.pending.${userId}`;
// Same persist-before-write shape as pendingKey, its own key so a pending
// scan and a pending move can never collide or overwrite each other.
export const pendingMoveKey = (userId: string) => `upkeep.pending-move.${userId}`;

// Device-level preferences (not per account): appearance and the nav-bar
// layout. One JSON blob under one key -- SecureStore is fine for a few dozen
// bytes and it is already the app's only key-value store.
export const PREFS_KEY = 'upkeep.prefs.v1';
