import { FINISHES, type Candidate, type CatalogBundle, type Printing } from './types';

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
      (p.imageUri !== undefined && (typeof p.imageUri !== 'string' || !p.imageUri.startsWith('https://')))) throw new Error('Invalid printing in catalog');
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
  constructor(value: unknown) {
    this.bundle = parseCatalog(value);
    for (const p of this.bundle.printings) {
      this.byId.set(p.id, p);
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
  search(text: string, hints: { setCode?: string; collectorNumber?: string } = {}, limit = 50): Candidate[] {
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
      const exactPrinting = !!hints.setCode && !!hints.collectorNumber &&
        hints.setCode.toLowerCase() === printing.setCode.toLowerCase() &&
        canonicalNumber(hints.collectorNumber) === canonicalNumber(printing.collectorNumber);
      const candidate: Candidate = { printing, score, evidence: exactPrinting ? 'printing' : 'name' };
      if (!results.has(id) || results.get(id)!.score < score) results.set(id, candidate);
    }
    return [...results.values()].sort((a,b) => Number(b.evidence === 'printing') - Number(a.evidence === 'printing') ||
      b.score - a.score || a.printing.name.localeCompare(b.printing.name) || a.printing.id.localeCompare(b.printing.id)).slice(0, Math.max(1, Math.min(200, limit)));
  }
}
function canonicalNumber(value: string) { return value.split('/')[0]!.trim().toLowerCase().replace(/^0+(?=\d)/, ''); }

export function printingHints(lines: string[]): {setCode?: string; collectorNumber?: string} {
  for (const line of lines) {
    const match = line.toUpperCase().match(/\b([A-Z0-9]{2,6})\s+(\d{1,5}[A-Z★]?)(?:\s*\/\s*\d+)?\b/);
    if (match && /[A-Z]/.test(match[1]!)) return { setCode: match[1], collectorNumber: match[2] };
  }
  return {};
}
