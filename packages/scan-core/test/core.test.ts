import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, parseCatalog, normalizeName, ScanPipeline, ConfirmScan, validateDraft, createCollectionWriter, createMoveWriter, type CatalogBundle, type CollectionDraft, type CollectionStore, type MoveStore, type StackMoveDraft } from '../src';
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
  const work = deferred<{id:string; replayed:boolean; quantity:number}>();
  const confirm = new ConfirmScan({save:async()=>{calls++;return work.promise;}});
  const first = confirm.save({operationId:op,draft},printing);
  const second = confirm.save({operationId:op,draft},printing);
  assert.equal(first,second);
  assert.throws(()=>confirm.save({operationId:op,draft:{...draft,quantity:2}},printing),/different details/);
  work.resolve({id:op,replayed:false,quantity:1}); await first; assert.equal(calls,1);
});
const staleTargetMessage = 'That stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours';

test('database writer decides a target from the store and applies through apply_stack_addition', async () => {
  let applyCalls = 0;
  const store: CollectionStore = {
    currentUserId: async () => oracle,
    findCandidates: async () => [{ id: 'row-1', quantity: 3, notes: null }],
    applyStackAddition: async input => {
      applyCalls++;
      assert.equal(input.targetInstanceId, 'row-1');
      assert.equal(input.operationId, op);
      return { instanceId: 'row-1', quantity: 4, replayed: false };
    },
  };
  const writer = createCollectionWriter(store);
  assert.deepEqual(await writer.save({ operationId: op, draft }), { id: 'row-1', quantity: 4, replayed: false });
  assert.equal(applyCalls, 1);
});

test("a replay returns the ledger's recorded result and reports itself as a replay, not a re-application", async () => {
  let applyCalls = 0;
  const store: CollectionStore = {
    currentUserId: async () => oracle,
    findCandidates: async () => [],
    applyStackAddition: async () => { applyCalls++; return { instanceId: op, quantity: 1, replayed: true }; },
  };
  const writer = createCollectionWriter(store);
  assert.deepEqual(await writer.save({ operationId: op, draft }), { id: op, quantity: 1, replayed: true });
  assert.equal(applyCalls, 1, 'the writer itself makes exactly one call; the ledger, not this store, is what stops a retry from re-applying');
});

test('a replay with a different payload is rejected, not silently reapplied', async () => {
  const store: CollectionStore = {
    currentUserId: async () => oracle,
    findCandidates: async () => [],
    applyStackAddition: async () => { throw new Error('This operation was already submitted with different details'); },
  };
  const writer = createCollectionWriter(store);
  await assert.rejects(writer.save({ operationId: op, draft }), /different details/);
});

test('a stale-target response triggers exactly one automatic re-decide-and-retry with the same operation id', async () => {
  let findCalls = 0;
  let applyCalls = 0;
  const store: CollectionStore = {
    currentUserId: async () => oracle,
    findCandidates: async () => {
      findCalls++;
      return findCalls === 1 ? [{ id: 'stale-row', quantity: 3, notes: null }] : [{ id: 'fresh-row', quantity: 5, notes: null }];
    },
    applyStackAddition: async input => {
      applyCalls++;
      assert.equal(input.operationId, op, 'a retry after a stale target must reuse the same operation id');
      if (applyCalls === 1) {
        assert.equal(input.targetInstanceId, 'stale-row');
        throw new Error(staleTargetMessage);
      }
      assert.equal(input.targetInstanceId, 'fresh-row');
      return { instanceId: 'fresh-row', quantity: 7, replayed: false };
    },
  };
  const writer = createCollectionWriter(store);
  assert.deepEqual(await writer.save({ operationId: op, draft }), { id: 'fresh-row', quantity: 7, replayed: false });
  assert.equal(findCalls, 2);
  assert.equal(applyCalls, 2);
});

test('a second stale-target response is surfaced to the caller, not retried again', async () => {
  const store: CollectionStore = {
    currentUserId: async () => oracle,
    findCandidates: async () => [{ id: 'row', quantity: 1, notes: null }],
    applyStackAddition: async () => { throw new Error(staleTargetMessage); },
  };
  const writer = createCollectionWriter(store);
  await assert.rejects(writer.save({ operationId: op, draft }), /no longer matches/);
});

test('unauthenticated save fails closed before querying the store at all', async () => {
  const writer = createCollectionWriter({
    currentUserId: async () => null,
    findCandidates: async () => { assert.fail('must not query candidates while signed out'); },
    applyStackAddition: async () => { assert.fail('must not apply while signed out'); },
  });
  await assert.rejects(writer.save({ operationId: op, draft }), /Sign in/);
});

// ---------------------------------------------------------------------------
// createMoveWriter (Phase 4b/4c: sleeve/unsleeve, apply_stack_move)
// ---------------------------------------------------------------------------
const moveOp = '55555555-5555-4555-8555-555555555555';
const moveDraft: StackMoveDraft = {
  sourceInstanceId: 'source-row', cardId: a, condition: 'NM', finish: 'nonfoil', language: 'en',
  quantity: 2, destinationLocationId: 'deck-1',
};
const staleSourceMessage = 'That source copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours';
const staleDestinationMessage = 'That destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours';

test('move writer decides a destination target from the store and applies through apply_stack_move', async () => {
  let applyCalls = 0;
  const store: MoveStore = {
    findDestinationCandidates: async () => [{ id: 'dest-row', quantity: 3, notes: null }],
    applyStackMove: async input => {
      applyCalls++;
      assert.equal(input.destinationTargetInstanceId, 'dest-row');
      assert.equal(input.sourceInstanceId, 'source-row');
      assert.equal(input.operationId, moveOp);
      return { instanceId: 'dest-row', quantity: 5, replayed: false };
    },
  };
  const writer = createMoveWriter(store);
  assert.deepEqual(
    await writer.move({ operationId: moveOp, draft: moveDraft }),
    { instanceId: 'dest-row', quantity: 5, replayed: false },
  );
  assert.equal(applyCalls, 1);
});

test('move writer inserts a fresh row when no destination candidate matches', async () => {
  const store: MoveStore = {
    findDestinationCandidates: async () => [],
    applyStackMove: async input => {
      assert.equal(input.destinationTargetInstanceId, null);
      return { instanceId: 'new-row', quantity: 2, replayed: false };
    },
  };
  const writer = createMoveWriter(store);
  assert.deepEqual(
    await writer.move({ operationId: moveOp, draft: moveDraft }),
    { instanceId: 'new-row', quantity: 2, replayed: false },
  );
});

test('move writer replay returns the recorded result and applies exactly once', async () => {
  let applyCalls = 0;
  const store: MoveStore = {
    findDestinationCandidates: async () => [],
    applyStackMove: async () => { applyCalls++; return { instanceId: 'new-row', quantity: 2, replayed: true }; },
  };
  const writer = createMoveWriter(store);
  assert.deepEqual(
    await writer.move({ operationId: moveOp, draft: moveDraft }),
    { instanceId: 'new-row', quantity: 2, replayed: true },
  );
  assert.equal(applyCalls, 1, 'the writer makes exactly one call; the ledger is what stops a retry from re-applying');
});

test('move writer rejects a replay submitted with different details', async () => {
  const store: MoveStore = {
    findDestinationCandidates: async () => [],
    applyStackMove: async () => { throw new Error('This operation was already submitted with different details'); },
  };
  const writer = createMoveWriter(store);
  await assert.rejects(writer.move({ operationId: moveOp, draft: moveDraft }), /different details/);
});

test('a stale DESTINATION target triggers exactly one automatic re-decide-and-retry with the same operation id', async () => {
  let findCalls = 0;
  let applyCalls = 0;
  const store: MoveStore = {
    findDestinationCandidates: async () => {
      findCalls++;
      return findCalls === 1 ? [{ id: 'stale-dest', quantity: 3, notes: null }] : [{ id: 'fresh-dest', quantity: 5, notes: null }];
    },
    applyStackMove: async input => {
      applyCalls++;
      assert.equal(input.operationId, moveOp, 'a retry after a stale destination must reuse the same operation id');
      if (applyCalls === 1) {
        assert.equal(input.destinationTargetInstanceId, 'stale-dest');
        throw new Error(staleDestinationMessage);
      }
      assert.equal(input.destinationTargetInstanceId, 'fresh-dest');
      return { instanceId: 'fresh-dest', quantity: 7, replayed: false };
    },
  };
  const writer = createMoveWriter(store);
  assert.deepEqual(
    await writer.move({ operationId: moveOp, draft: moveDraft }),
    { instanceId: 'fresh-dest', quantity: 7, replayed: false },
  );
  assert.equal(findCalls, 2);
  assert.equal(applyCalls, 2);
});

test('a second stale-destination response is surfaced to the caller, not retried again', async () => {
  const store: MoveStore = {
    findDestinationCandidates: async () => [{ id: 'row', quantity: 1, notes: null }],
    applyStackMove: async () => { throw new Error(staleDestinationMessage); },
  };
  const writer = createMoveWriter(store);
  await assert.rejects(writer.move({ operationId: moveOp, draft: moveDraft }), /no longer matches the decided target/);
});

test('a stale SOURCE is retried once with the identical call, then surfaced if still stale', async () => {
  let applyCalls = 0;
  const store: MoveStore = {
    findDestinationCandidates: async () => [{ id: 'dest-row', quantity: 3, notes: null }],
    applyStackMove: async input => {
      applyCalls++;
      assert.equal(input.sourceInstanceId, 'source-row', 'a stale-source retry has nothing to re-decide about the source');
      if (applyCalls === 1) throw new Error(staleSourceMessage);
      return { instanceId: 'dest-row', quantity: 5, replayed: false };
    },
  };
  const writer = createMoveWriter(store);
  assert.deepEqual(
    await writer.move({ operationId: moveOp, draft: moveDraft }),
    { instanceId: 'dest-row', quantity: 5, replayed: false },
  );
  assert.equal(applyCalls, 2, 'exactly one retry for a stale source, not unbounded retrying');
});

test('a second stale-source response is surfaced to the caller, not retried again', async () => {
  let applyCalls = 0;
  const store: MoveStore = {
    findDestinationCandidates: async () => [],
    applyStackMove: async () => { applyCalls++; throw new Error(staleSourceMessage); },
  };
  const writer = createMoveWriter(store);
  await assert.rejects(writer.move({ operationId: moveOp, draft: moveDraft }), /no longer matches what was decided/);
  assert.equal(applyCalls, 2, 'one retry, then surfaced -- not retried a third time');
});
