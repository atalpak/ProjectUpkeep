// SecureStore key builders for the two independent recovery records this app
// persists before a risky write — a pending scan and a pending sleeve/
// unsleeve. Own module so AppProvider, ScanScreen and DeckDetailScreen all
// derive the same key from a userId rather than each hand-rolling the
// template string.
export const pendingKey = (userId: string) => `upkeep.pending.${userId}`;
// Same persist-before-write shape as pendingKey, its own key so a pending
// scan and a pending move can never collide or overwrite each other.
export const pendingMoveKey = (userId: string) => `upkeep.pending-move.${userId}`;
