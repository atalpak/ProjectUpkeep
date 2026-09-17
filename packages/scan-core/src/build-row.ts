import { isUuid, normalizeName } from './catalog';
import { FINISHES, type Printing } from './types';

/**
 * Maps one line of `scripts/export-catalog.ts`'s JSONL into a `Printing`, or
 * says why it can't.
 *
 * Kept in `src/` rather than inline in `scripts/build-catalog.ts` for the same
 * reason `toCardRow` lives in `src/lib/scryfall.ts` rather than inline in
 * `scripts/sync-scryfall.ts` on the web side: a pure mapping function is
 * testable with `test/*.test.ts` without spawning the CLI script or a real
 * file on disk.
 *
 * `seenIds` is mutated on success — the caller reuses the same `Set` across
 * every row in a build so a duplicate id later in the file is caught here
 * rather than surfacing as `parseCatalog`'s bundle-wide "duplicate id" error,
 * which carries no line number.
 */
export function buildCatalogRow(row: Record<string, unknown>, line: number, seenIds: Set<string>): Printing | { skipped: string } {
  if (row.digital === true || row.oracle_id == null) return { skipped: `line ${line}: digital or no oracle_id` };
  if (!Array.isArray(row.available_finishes)) return { skipped: `line ${line}: missing available_finishes` };
  const id = String(row.id ?? '');
  const oracleId = String(row.oracle_id ?? '');
  if (!isUuid(id) || !isUuid(oracleId)) return { skipped: `line ${line}: id/oracle_id is not a UUID` };
  if (seenIds.has(id)) return { skipped: `line ${line}: duplicate id ${id}` };
  const setCode = String(row.set_code ?? '');
  if (!/^[a-z0-9]{2,8}$/i.test(setCode)) return { skipped: `line ${line}: unusable set code "${setCode}"` };
  const faces = Array.isArray(row.card_faces) ? row.card_faces as Array<{ name?: string }> : [];
  const aliases = [row.flavor_name, ...faces.flatMap(f => [f.name])]
    .filter((a): a is string => typeof a === 'string' && !!a.trim());
  const finishes = row.available_finishes.filter((f: unknown) => FINISHES.includes(f as typeof FINISHES[number]));
  if (finishes.length === 0) return { skipped: `line ${line}: no supported finish in available_finishes` };
  const name = String(row.name ?? '');
  const collectorNumber = String(row.collector_number ?? '');
  const language = String(row.lang ?? '');
  if (!name || !collectorNumber || !language) return { skipped: `line ${line}: missing a required field` };
  // Real, confirmed against the live export: Un-set joke cards like "_____"
  // (Unhinged, Unknown Event) have a `name` that is entirely punctuation, so
  // it normalizes to the empty string -- `parseCatalog`'s own name check
  // would otherwise reject the whole bundle over one row with no line number
  // to chase down.
  if (!normalizeName(name)) return { skipped: `line ${line}: name "${name}" has no matchable characters` };
  seenIds.add(id);
  return {
    id, oracleId, name, aliases, setCode, collectorNumber, finishes, language,
    ...(typeof row.image_uri === 'string' && row.image_uri ? { imageUri: row.image_uri } : {}),
    ...(typeof row.set_name === 'string' && row.set_name ? { setName: row.set_name } : {}),
    ...(typeof row.released_at === 'string' && row.released_at ? { releasedAt: row.released_at } : {}),
    ...(typeof row.rarity === 'string' && row.rarity ? { rarity: row.rarity } : {}),
  };
}
