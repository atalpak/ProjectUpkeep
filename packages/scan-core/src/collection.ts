import { isUuid } from './catalog';
import { CONDITIONS, FINISHES, LANGUAGES, type CollectionDraft, type CollectionWriter, type ConfirmedScan, type Printing } from './types';
export function validateDraft(draft: CollectionDraft, printing: Printing): CollectionDraft {
  if (!isUuid(draft.card_id) || draft.card_id !== printing.id) throw new Error('Choose an exact printing.');
  if (!CONDITIONS.includes(draft.condition)) throw new Error('Choose a condition.');
  if (!FINISHES.includes(draft.finish) || !printing.finishes.includes(draft.finish)) throw new Error('Choose an available finish.');
  if (!(LANGUAGES as readonly string[]).includes(draft.language)) throw new Error('Choose a supported language.');
  if (!Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 10_000) throw new Error('Quantity must be a whole number from 1 to 10000.');
  if (draft.location_id !== null && !isUuid(draft.location_id)) throw new Error('Choose a valid location.');
  if (draft.notes !== null && (typeof draft.notes !== 'string' || draft.notes.length > 2000)) throw new Error('Notes must be 2000 characters or fewer.');
  return { ...draft, notes: draft.notes?.trim() || null };
}
/** Collapse duplicate taps. Retrying an uncertain write MUST reuse operationId and identical draft. */
// Scope this controller to a single review sheet; discard it when that review completes.
export class ConfirmScan {
  private pending = new Map<string, Promise<{id: string}>>();
  private payloads = new Map<string, string>();
  constructor(private writer: CollectionWriter) {}
  save(scan: ConfirmedScan, printing: Printing) {
    if (!isUuid(scan.operationId)) throw new Error('Invalid scan operation.');
    const draft = validateDraft(scan.draft, printing);
    const payload = JSON.stringify(draft);
    const previous = this.payloads.get(scan.operationId);
    if (previous && previous !== payload) throw new Error('This scan was already submitted with different details.');
    if (this.pending.has(scan.operationId)) return this.pending.get(scan.operationId)!;
    this.payloads.set(scan.operationId, payload);
    const operation = Promise.resolve().then(() => this.writer.save({ operationId: scan.operationId, draft }));
    this.pending.set(scan.operationId, operation);
    // Keep only in-flight requests. Durable idempotency lives in the database
    // now (collection_write_ops, migration 36) — this in-memory map only
    // collapses double-taps that happen to overlap in time; a retry after
    // this map has forgotten the operation (a later tap, or a fresh app
    // launch recovering a pending write) is still safe, because the ledger
    // resolves it to the same recorded result rather than re-applying it.
    void operation.then(() => this.pending.delete(scan.operationId), () => this.pending.delete(scan.operationId));
    return operation;
  }
}
