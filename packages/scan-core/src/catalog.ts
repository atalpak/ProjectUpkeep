import { FINISHES, type Candidate, type CatalogBundle, type Printing } from './types';
import { canonicalNumber } from './printing';

export function normalizeName(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
}
const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 2) }, (_, i) => s.slice(i, i + 3)));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }

/** Validate before replacing a previously usable catalog. No unchecked JSON casts. */
export function parseCatalog(value: unknown): CatalogBundle {
  const b = value as CatalogBundle;
  if (!b || b.schemaVersion !== 1 || typeof b.version !== 'string' || !b.version.trim() ||
      typeof b.generatedAt !== 'string' || !Number.isFinite(Date.parse(b.generatedAt)) ||
      !Array.isArray(b.printings) || b.printings.length === 0 || b.printings.length > 300_000) throw new Error('Invalid catalog bundle');
  const ids = new Set<string>();
  for (const p of b.printings) {
    if (!p || !isUuid(p.id) || !isUuid(p.oracleId) || ids.has(p.id) || typeof p.name !== 'string' || !normalizeName(p.name) ||
      typeof p.setCode !== 'string' || !/^[a-z0-9]{2,8}$/i.test(p.setCode) || typeof p.collectorNumber !== 'string' || !p.collectorNumber ||
      !Array.isArray(p.aliases) || p.aliases.some(a => typeof a !== 'string') ||
      !Array.isArray(p.finishes) || p.finishes.length === 0 || p.finishes.some(f => !FINISHES.includes(f)) ||
      typeof p.language !== 'string' || !p.language ||
      (p.imageUri !== undefined && (typeof p.imageUri !== 'string' || !p.imageUri.startsWith('https://'))) ||
      (p.setName !== undefined && typeof p.setName !== 'string') ||
      (p.releasedAt !== undefined && typeof p.releasedAt !== 'string') ||
      (p.rarity !== undefined && typeof p.rarity !== 'string')) throw new Error('Invalid printing in catalog');
    ids.add(p.id);
  }
  return b;
}

/** Build once per bundle. Inverted trigram postings avoid scoring the entire catalog per frame. */
export class CardIndex {
  readonly bundle: CatalogBundle;
  private names = new Map<string, Set<string>>();
  private postings = new Map<string, Set<string>>();
  private byId = new Map<string, Printing>();
  private byOracle = new Map<string, Printing[]>();
  private sets = new Set<string>();
  constructor(value: unknown) {
    this.bundle = parseCatalog(value);
    for (const p of this.bundle.printings) {
      this.byId.set(p.id, p);
      this.sets.add(p.setCode.toLowerCase());
      if (!this.byOracle.has(p.oracleId)) this.byOracle.set(p.oracleId, []);
      this.byOracle.get(p.oracleId)!.push(p);
      for (const alias of [p.name, ...p.aliases]) {
        const key = normalizeName(alias);
        if (!key) continue;
        if (!this.names.has(key)) {
          this.names.set(key, new Set());
          for (const g of grams(key)) {
            if (!this.postings.has(g)) this.postings.set(g, new Set());
            this.postings.get(g)!.add(key);
          }
        }
        this.names.get(key)!.add(p.id);
      }
    }
  }
  get(id: string) { return this.byId.get(id); }
  /** Every printing of one card, in catalog order. Callers rank them (`rankPrintings`). */
  printingsOf(oracleId: string): Printing[] { return this.byOracle.get(oracleId) ?? []; }
  /** Lower-case set codes present in the catalog: lets footer OCR reject a token that is not a set. */
  get setCodes(): ReadonlySet<string> { return this.sets; }

  /**
   * Ranks every printing whose name plausibly matches `text`, then narrows
   * (never re-orders past that) by `filter`.
   *
   * `hints` and `filter` are deliberately two different parameters, not one:
   * `hints` (typically OCR-derived — see `printingHints`) only re-ranks a
   * candidate to `evidence: 'printing'`, because OCR regularly misreads a set
   * code or collector number and a hard exclusion on that would silently drop
   * the correct card. `filter` (typed by a person, in the manual-search UI)
   * actually excludes non-matching printings — against a catalog where some
   * names have 100+ printings, ranking alone left `search` returning up to
   * `limit` results in an order with no way for the caller to reach the rest.
   */
  private rank(text: string, hints: { setCode?: string; collectorNumber?: string } = {}, filter: { setCode?: string; collectorNumber?: string } = {}): Candidate[] {
    const q = normalizeName(text.slice(0, 200));
    if (q.length < 2) return [];
    const exact = this.names.get(q);
    const ranked: Array<[string, number]> = [];
    if (exact) ranked.push([q, 1]);
    else {
      const qg = grams(q);
      const overlaps = new Map<string, number>();
      for (const g of qg) for (const key of this.postings.get(g) ?? []) overlaps.set(key, (overlaps.get(key) ?? 0) + 1);
      // Cap detailed comparisons, preserving the candidates with the most shared evidence.
      for (const [key, count] of [...overlaps].sort((a,b) => b[1]-a[1]).slice(0, 256)) {
        const score = 2 * count / (qg.size + grams(key).size);
        if (score >= 0.45) ranked.push([key, score]);
      }
    }
    const results = new Map<string, Candidate>();
    for (const [key, score] of ranked) for (const id of this.names.get(key)!) {
      const printing = this.byId.get(id)!;
      if (filter.setCode && filter.setCode.toLowerCase() !== printing.setCode.toLowerCase()) continue;
      if (filter.collectorNumber && canonicalNumber(filter.collectorNumber) !== canonicalNumber(printing.collectorNumber)) continue;
      const exactPrinting = !!hints.setCode && !!hints.collectorNumber &&
        hints.setCode.toLowerCase() === printing.setCode.toLowerCase() &&
        canonicalNumber(hints.collectorNumber) === canonicalNumber(printing.collectorNumber);
      const candidate: Candidate = { printing, score, evidence: exactPrinting ? 'printing' : 'name' };
      if (!results.has(id) || results.get(id)!.score < score) results.set(id, candidate);
    }
    return [...results.values()].sort((a,b) => Number(b.evidence === 'printing') - Number(a.evidence === 'printing') ||
      b.score - a.score || a.printing.name.localeCompare(b.printing.name) || newestFirst(a.printing, b.printing));
  }

  search(text: string, hints: { setCode?: string; collectorNumber?: string } = {}, filter: { setCode?: string; collectorNumber?: string } = {}, limit = 50): Candidate[] {
    return this.rank(text, hints, filter).slice(0, Math.max(1, Math.min(200, limit)));
  }

  /**
   * Same ranking as `search`, plus the true match count before truncation —
   * what the manual-search UI needs to say "50 of 118 matched" honestly
   * instead of showing a capped list with no indication more exist.
   */
  searchWithTotal(text: string, hints: { setCode?: string; collectorNumber?: string } = {}, filter: { setCode?: string; collectorNumber?: string } = {}, limit = 50): { results: Candidate[]; total: number } {
    const all = this.rank(text, hints, filter);
    return { results: all.slice(0, Math.max(1, Math.min(200, limit))), total: all.length };
  }
}

/**
 * Between printings of equal name and score: newest release, then set and
 * number. This replaced a compare on the internal UUID, which made the printing
 * a name-only match landed on effectively random. The id only separates rows
 * that are identical in every visible respect.
 */
function newestFirst(a: Printing, b: Printing): number {
  return (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.setCode.localeCompare(b.setCode) ||
    canonicalNumber(a.collectorNumber).localeCompare(canonicalNumber(b.collectorNumber), 'en', { numeric: true }) || a.id.localeCompare(b.id);
}
