import type { CollectionDraft, CollectionWriter } from './types';
export interface SavedRow extends CollectionDraft { id: string; owner_user_id: string }
export interface CollectionStore {
  currentUserId(): Promise<string | null>;
  insert(row: SavedRow): Promise<void>;
  find(id: string): Promise<SavedRow | null>;
}
/** Phase-one adapter: append one row per confirmed scan. Never read/modify/write shared quantities. */
export function createCollectionWriter(store: CollectionStore): CollectionWriter {
  return { async save({ operationId, draft }) {
    const owner = await store.currentUserId();
    if (!owner) throw new Error('Sign in to save to your collection.');
    const expected: SavedRow = { ...draft, id: operationId, owner_user_id: owner };
    try { await store.insert(expected); }
    catch (original) {
      // A response can be lost after INSERT commits. Verify instead of blindly adding again.
      let existing: SavedRow | null;
      try { existing = await store.find(operationId); } catch { throw original; }
      if (!existing || (Object.keys(expected) as Array<keyof SavedRow>).some(k => expected[k] !== existing![k])) throw original;
    }
    return { id: operationId };
  }};
}
