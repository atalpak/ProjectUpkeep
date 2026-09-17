import { createReadStream } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseCatalog, FINISHES, type Printing } from '../src';

// Input is JSONL from the EXISTING Upkeep cards sync/export, not the raw multi-GB image corpus.
const [source, output, version] = process.argv.slice(2);
if (!source || !output || !version) throw new Error('Usage: npm run catalog:build -- cards.jsonl catalog.json VERSION');
const printings: Printing[] = [];
let line = 0;
for await (const text of createInterface({ input: createReadStream(source), crlfDelay: Infinity })) {
  line++;
  if (!text.trim()) continue;
  const row = JSON.parse(text);
  if (row.digital === true || row.oracle_id == null) continue;
  if (!Array.isArray(row.available_finishes)) throw new Error(`Missing available_finishes at line ${line}`);
  printings.push({
    id: row.id, oracleId: row.oracle_id, name: row.name,
    aliases: [row.flavor_name, row.printed_name, ...(row.card_faces ?? []).flatMap((f: {name?: string; printed_name?: string}) => [f.name, f.printed_name])].filter((a): a is string => typeof a === 'string' && !!a.trim()),
    setCode: row.set_code, collectorNumber: row.collector_number,
    finishes: row.available_finishes.filter((f: unknown) => FINISHES.includes(f as typeof FINISHES[number])),
    language: row.lang, ...(row.image_uri ? { imageUri: row.image_uri } : {}),
  });
}
const bundle = parseCatalog({schemaVersion:1, version, generatedAt:new Date().toISOString(), printings});
const json = JSON.stringify(bundle);
if (Buffer.byteLength(json) > 40_000_000) throw new Error('Catalog exceeds 40 MB. Shard by language/set before publishing.');
await writeFile(output + '.next', json);
await rename(output + '.next', output);
console.log(`Wrote ${printings.length} printings, ${Buffer.byteLength(json)} bytes to ${output}`);
