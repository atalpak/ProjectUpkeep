import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CardIndex, QUICK_MIN_SCORE, QUICK_AMBIGUITY_MARGIN } from '../src';
import { parseCases, scoreCases, sweep, tally, bandSummary, type Tally } from '../src/accuracy';

/**
 * Offline scan-accuracy measurement, so QUICK_MIN_SCORE and
 * QUICK_AMBIGUITY_MARGIN can be tuned from data instead of from holding cards
 * up to a phone. Runs the shipped matching (see ../src/accuracy.ts) over
 * labelled OCR reads and reports, per cutoff pair, how many reads were an
 * exact-printing hit, the right card but the wrong printing, the wrong card,
 * or abstained on.
 *
 *   npm run accuracy -w @upkeep/scan-core                    # bundled illustrative sample
 *   npm run accuracy -w @upkeep/scan-core -- --catalog catalog.json --reads reads.json [--json]
 *
 * Default inputs are the illustrative sample in scripts/fixtures/, so it runs
 * with no download (nothing in CI runs it); its numbers are NOT a real accuracy figure. A
 * --catalog path that does not exist skips with a message (exit 0), because a
 * developer without the ~40 MB catalog is not a failing build. Real evidence
 * needs real reads: capture `{lines, printingLines}` from the scanner and label
 * each with the printing id it should have resolved to.
 */
const here = (f: string) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const explicitCatalog = flag('--catalog');
const catalogPath = explicitCatalog ?? here('accuracy-sample-catalog.json');
const readsPath = flag('--reads') ?? here('accuracy-sample-reads.json');
const asJson = args.includes('--json');
const usingSample = !explicitCatalog;

async function main() {
  if (!existsSync(catalogPath)) {
    console.log(`accuracy: skipped, no catalog at ${catalogPath}. Build one with \`npm run catalog:build -w @upkeep/scan-core\` and pass --catalog <path>.`);
    // A path the caller typed that is missing is a mistake, not a developer without the catalog.
    if (explicitCatalog) process.exitCode = 1;
    return;
  }
  if (!existsSync(readsPath)) throw new Error(`Reads file not found: ${readsPath}`);
  const index = new CardIndex(JSON.parse(await readFile(catalogPath, 'utf8')));
  const cases = parseCases(JSON.parse(await readFile(readsPath, 'utf8')));
  const { scored, missing } = scoreCases(index, cases);
  const current = { minScore: QUICK_MIN_SCORE, ambiguityMargin: QUICK_AMBIGUITY_MARGIN };
  const rows = sweep(scored);
  const shipped = tally(scored, current);
  const bands = bandSummary(scored);

  if (asJson) {
    console.log(JSON.stringify({ catalog: index.bundle.version, printings: index.bundle.printings.length, cases: cases.length, missing, shipped: { ...current, tally: shipped }, sweep: rows, bands }, null, 2));
    return;
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '-').padStart(4);
  const line = (t: Tally) => `${String(t.exact).padStart(3)} ${pct(t.exact, t.total)}  ${String(t.wrongPrinting).padStart(3)}  ${String(t.wrongCard).padStart(3)}  ${String(t.abstained).padStart(3)}  ${String(t.pinnedWrong).padStart(3)}   ${t.falseAccepts}/${t.noCardTotal}`;
  console.log(`catalog ${index.bundle.version} (${index.bundle.printings.length} printings), ${cases.length} reads${usingSample ? '  [ILLUSTRATIVE SAMPLE: not a real accuracy figure]' : ''}`);
  if (missing.length) console.log(`skipped ${missing.length} read(s) whose expectedId is not in this catalog: ${missing.join('; ')}`);
  console.log(`\nquickMatch sweep (labelled reads: ${shipped.total}; "no card" reads: ${shipped.noCardTotal}). * = shipped cutoffs`);
  console.log('minScore margin | exact     wrongPrint wrongCard abstain pinnedWrong falseAccept');
  for (const r of rows) {
    const mark = r.minScore === current.minScore && r.ambiguityMargin === current.ambiguityMargin ? '*' : ' ';
    console.log(`${mark} ${r.minScore.toFixed(2)}    ${r.ambiguityMargin.toFixed(2)}  | ${line(r.tally)}`);
  }
  console.log('\ncolumns: exact = right printing; wrongPrint = right card, other printing; wrongCard = a different card;');
  console.log('abstain = no answer; pinnedWrong = accepted AND claimed the exact printing but was wrong (a subset of the wrong columns);');
  console.log('falseAccept = "no card" reads wrongly accepted.');
  console.log('\nscanner bands (top candidate, no abstaining):');
  for (const [band, b] of Object.entries(bands)) console.log(`  ${band.padEnd(9)} ${String(b.total).padStart(3)} reads, top exact ${b.topExact}, top right card ${b.topSameCard}`);
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
