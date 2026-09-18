import { createReadStream } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseCatalog, buildCatalogRow, type Printing } from '../src';

// Input is JSONL from `scripts/export-catalog.ts` at the repo root (the
// "existing Upkeep cards sync/export" this comment used to gesture at before
// that script existed).
const [source, output, version] = process.argv.slice(2);
if (!source || !output || !version) throw new Error('Usage: npm run catalog:build -- cards.jsonl catalog.json VERSION');

/**
 * One bad row used to throw and take the whole build down with it, with no
 * row number to go find. Real Scryfall data has edge cases a synthetic
 * 3-card demo never exercised — Un-set cards, empty `available_finishes`,
 * unusual set codes — so a row that fails validation (`buildCatalogRow`, in
 * `../src/build-row.ts` so it is unit-testable) is skipped and counted
 * instead, and the reason goes in the build summary below.
 */
async function main(source: string, output: string, version: string) {
  const printings: Printing[] = [];
  const skipped: string[] = [];
  const seenIds = new Set<string>();
  let line = 0;
  for await (const text of createInterface({ input: createReadStream(source), crlfDelay: Infinity })) {
    line++;
    if (!text.trim()) continue;
    let row: Record<string, unknown>;
    try { row = JSON.parse(text); } catch { skipped.push(`line ${line}: invalid JSON`); continue; }
    const result = buildCatalogRow(row, line, seenIds);
    if ('skipped' in result) { skipped.push(result.skipped); continue; }
    printings.push(result);
  }

  const bundle = parseCatalog({ schemaVersion: 1, version, generatedAt: new Date().toISOString(), printings });
  const json = JSON.stringify(bundle);
  // The published catalog was ~39.98 MB, 18 KB under the previous 40 MB cap, so the next
  // new set would have failed every nightly publish. 48 MB stays under the storage
  // bucket's 50 MB fileSizeLimit (scripts/create-catalog-bucket.ts) and the app's 80 MB
  // download cap. Past this, slim the bundle or shard it rather than raising it again.
  if (Buffer.byteLength(json) > 48_000_000) throw new Error('Catalog exceeds 48 MB. Slim or shard it before publishing.');
  await writeFile(output + '.next', json);
  await rename(output + '.next', output);

  console.log(`Wrote ${printings.length} printings, ${Buffer.byteLength(json)} bytes to ${output}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} row(s):`);
    // A full per-line dump is not useful past a few dozen; the count above is
    // the number that matters for "did the build mostly succeed".
    for (const reason of skipped.slice(0, 50)) console.log(`  - ${reason}`);
    if (skipped.length > 50) console.log(`  ... and ${skipped.length - 50} more`);
  }
}

main(source, output, version).catch((error: unknown) => {
  console.error(`[catalog:build] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
