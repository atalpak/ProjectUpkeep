import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, parseCatalog, normalizeName, ScanPipeline, ConfirmScan, validateDraft, createCollectionWriter, type CatalogBundle, type CollectionDraft, type SavedRow } from '../src';
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const op = '33333333-3333-4333-8333-333333333333';
const oracle = '44444444-4444-4444-8444-444444444444';
const bundle: CatalogBundle = {schemaVersion:1,version:'test',generatedAt:'2026-09-16T00:00:00Z',printings:[
  {id:a,oracleId:oracle,name:'Lightning Bolt',aliases:['Éclair','稲妻'],setCode:'m11',collectorNumber:'146',language:'en',finishes:['nonfoil','foil']},
  {id:b,oracleId:oracle,name:'Lightning Bolt',aliases:[],setCode:'sta',collectorNumber:'42',language:'en',finishes:['foil','etched']},
]};
const printing = bundle.printings[0]!;
const draft: CollectionDraft = {card_id:a,condition:'NM',finish:'foil',language:'en',quantity:1,location_id:null,notes:null};
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(r => resolve=r); return {promise,resolve}; }

test('normalization retains non-Latin names and diacritics aliases', () => {
  assert.equal(normalizeName('Éclair!'),'eclair');
  assert.equal(new CardIndex(bundle).search('稲妻')[0]?.printing.id,a);
});
test('exact name retains multiple printings and set/number ranks the printing without inferring finish', () => {
  const index = new CardIndex(bundle);
  assert.equal(index.search('Lightning Bolt').length,2);
  assert.equal(index.search('Lightning Bolt',{setCode:'STA',collectorNumber:'0042/100'})[0]?.printing.id,b);
  assert.equal(index.search('Lightning Bolt')[0]?.evidence,'name');
});
test('fuzzy OCR match is ranked and unrelated text is rejected', () => {
  const index = new CardIndex(bundle);
  assert.ok(index.search('Lightninq Bolt')[0]!.score > 0.5);
  assert.deepEqual(index.search('unrelated rules words'),[]);
  assert.deepEqual(index.search(''),[]);
});
test('malformed catalogs fail before replacing usable index', () => {
  assert.throws(() => parseCatalog({...bundle,schemaVersion:2}));
  assert.throws(() => parseCatalog({...bundle,printings:[printing,printing]}));
  assert.throws(() => parseCatalog({...bundle,printings:[{...printing,finishes:['wrong']}]}));
  assert.throws(() => parseCatalog({...bundle,printings:[{...printing,imageUri:'file:///secret'}]}));
});
test('every collection dimension is validated, including whole quantities and supported finishes', () => {
  assert.deepEqual(validateDraft(draft,printing),draft);
  for (const quantity of [0,-1,1.5,NaN,Infinity,10001]) assert.throws(() => validateDraft({...draft,quantity},printing));
  assert.throws(() => validateDraft({...draft,finish:'etched'},printing));
  assert.throws(() => validateDraft({...draft,condition:'BAD' as never},printing));
  assert.throws(() => validateDraft({...draft,language:''},printing));
  assert.throws(() => validateDraft({...draft,location_id:'Unsorted'},printing));
  assert.throws(() => validateDraft({...draft,card_id:b},printing));
});
test('pipeline single-flight lock survives cancellation until native work settles', async () => {
  const work = deferred<{lines:string[]}>();
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:()=>work.promise});
  const abort = new AbortController();
  const first = pipeline.scan('file:///photo',abort.signal);
  abort.abort();
  await assert.rejects(pipeline.scan('file:///another',new AbortController().signal),/already running/);
  work.resolve({lines:['Lightning Bolt']});
  await assert.rejects(first,/cancelled/);
  const next = await pipeline.scan('file:///another',new AbortController().signal);
  assert.equal(next.needsReview,true);
});
test('no OCR does not pretend candidate-only artwork matching is global image recognition', async () => {
  let comparisons = 0;
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:async()=>({lines:[]}),comparePrintings:async()=>{comparisons++;return a;}});
  const result = await pipeline.scan('file:///photo',new AbortController().signal);
  assert.equal(result.method,'none'); assert.equal(comparisons,0);
});
test('fallback failure retains OCR results and telemetry failures do not break scanning', async () => {
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:async()=>({lines:['Lightninq BoIt']}),identifyImage:async()=>{throw new Error('offline');},onEvent:()=>{throw new Error('telemetry');}});
  const result = await pipeline.scan('file:///photo',new AbortController().signal);
  assert.ok(result.candidates.length); assert.equal(result.warnings.length,1);
});
test('image fallback cannot inject unknown printing IDs', async () => {
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:async()=>({lines:[]}),identifyImage:async()=>[{printing:{...printing,id:op},score:1,evidence:'image'}]});
  assert.equal((await pipeline.scan('file:///photo',new AbortController().signal)).candidates.length,0);
});
test('double taps share one write and uncertain retry keeps operation ID', async () => {
  let calls = 0;
  const work = deferred<{id:string}>();
  const confirm = new ConfirmScan({save:async()=>{calls++;return work.promise;}});
  const first = confirm.save({operationId:op,draft},printing);
  const second = confirm.save({operationId:op,draft},printing);
  assert.equal(first,second);
  assert.throws(()=>confirm.save({operationId:op,draft:{...draft,quantity:2}},printing),/different details/);
  work.resolve({id:op}); await first; assert.equal(calls,1);
});
test('database writer recovers lost response without quantity increment', async () => {
  let row: SavedRow | null = null;
  const writer = createCollectionWriter({currentUserId:async()=>oracle,insert:async r=>{if (!row) row=r;throw new Error('lost response or duplicate');},find:async()=>row});
  assert.deepEqual(await writer.save({operationId:op,draft}),{id:op});
  assert.deepEqual(await writer.save({operationId:op,draft}),{id:op});
  assert.equal(row!.quantity,1);
  await assert.rejects(writer.save({operationId:op,draft:{...draft,quantity:2}}));
});
test('unauthenticated save and cross-account replay fail closed', async () => {
  const writer = createCollectionWriter({currentUserId:async()=>null,insert:async()=>assert.fail('must not insert'),find:async()=>null});
  await assert.rejects(writer.save({operationId:op,draft}),/Sign in/);
  const other = createCollectionWriter({currentUserId:async()=>b,insert:async()=>{throw new Error('denied');},find:async()=>({...draft,id:op,owner_user_id:a})});
  await assert.rejects(other.save({operationId:op,draft}),/denied/);
});
