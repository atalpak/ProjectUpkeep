import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardIndex, parseCatalog, normalizeName, ScanPipeline, ConfirmScan, validateDraft, createCollectionWriter, createMoveWriter, createReprintWriter, buildCatalogRow, scanBand, quickMatch, quickRejectionHint, readTitle, describeRejection, QUICK_LIGHT_HINT, QUICK_GLARE_HINT, QUICK_RETRY_CAP, type CatalogBundle, type CollectionDraft, type CollectionStore, type MoveStore, type StackMoveDraft, type ReprintStore, type StackReprintDraft, type Candidate } from '../src';
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
test('a typed filter excludes non-matching printings rather than only re-ranking them', () => {
  const index = new CardIndex(bundle);
  // Both printings still show up under a hint -- a hint only promotes evidence.
  assert.equal(index.search('Lightning Bolt', { setCode: 'sta', collectorNumber: '42' }).length, 2);
  // A filter actually narrows the result set.
  const filtered = index.search('Lightning Bolt', {}, { setCode: 'sta' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.printing.id, b);
  // A filtered-out set code returns nothing, not a fallback to the unfiltered set.
  assert.deepEqual(index.search('Lightning Bolt', {}, { setCode: 'xyz' }), []);
  // Collector number filters independently of set code, using the same
  // canonicalNumber normalisation search already applies to hints (leading
  // zeros, a "/100" print-run suffix).
  assert.equal(index.search('Lightning Bolt', {}, { collectorNumber: '0146/999' })[0]?.printing.id, a);
});
// ---------------------------------------------------------------------------
// CardIndex.byFooter / ScanPipeline footer-first fallback
// (backlog item 8, "other card languages", steps 3-4)
// ---------------------------------------------------------------------------
const jpId = '66666666-6666-4666-8666-666666666666';
const enId = '77777777-7777-4777-8777-777777777777';
const otherId = '88888888-8888-4888-8888-888888888888';
// Two languages of the SAME printing: identical set code + collector number,
// which is the whole reason a footer-only lookup can return more than one
// result. The Japanese printing's own catalog `name` (its printed-language
// name, not "Lightning Bolt") stands in for the real case this fallback
// exists for -- the catalog's aliases do not cover a foreign name, so text
// search can never find it, but the footer's set+number can.
const footerBundle: CatalogBundle = { schemaVersion: 1, version: 'footer-test', generatedAt: '2026-09-21T00:00:00Z', printings: [
  { id: enId, oracleId: oracle, name: 'Lightning Bolt', aliases: [], setCode: 'soc', collectorNumber: '236', language: 'en', finishes: ['nonfoil'] },
  { id: jpId, oracleId: oracle, name: '稲妻', aliases: [], setCode: 'soc', collectorNumber: '236', language: 'ja', finishes: ['nonfoil'] },
  { id: otherId, oracleId: oracle, name: 'Lightning Bolt', aliases: [], setCode: 'soc', collectorNumber: '999', language: 'en', finishes: ['nonfoil'] },
]};

test('CardIndex.byFooter: looks a printing up by set+number alone, with no name at all', () => {
  const index = new CardIndex(footerBundle);
  const found = index.byFooter('SOC', '0236');
  assert.deepEqual(found.map(p => p.id).sort(), [enId, jpId].sort());
});
test('CardIndex.byFooter: a set+number the catalog does not have returns nothing, never throws', () => {
  const index = new CardIndex(footerBundle);
  assert.deepEqual(index.byFooter('soc', '404'), []);
  assert.deepEqual(index.byFooter('zzz', '236'), []);
});
test('ScanPipeline.matchEvidence: footer fallback fires only when name matching found nothing/weak, and surfaces every language at that spot', () => {
  const pipeline = new ScanPipeline(new CardIndex(footerBundle), { readText: async () => ({ lines: [] }) });
  // No name text at all (a full-art card with the name off-frame): the footer alone finds both languages.
  const blank = pipeline.matchEvidence({ lines: [], printingLines: ['0236', 'SOC • JA'] });
  assert.deepEqual(blank.candidates.map(c => c.printing.id).sort(), [enId, jpId].sort());
  assert.ok(blank.candidates.every(c => c.evidence === 'printing'));
  assert.equal(blank.method, 'ocr');
  assert.equal(blank.languageHint, 'ja');
  // A name too garbled to match anything, but a clean footer: same fallback.
  const garbled = pipeline.matchEvidence({ lines: ['Xqqzzz Not Readable'], printingLines: ['0236', 'SOC • EN'] });
  assert.deepEqual(garbled.candidates.map(c => c.printing.id).sort(), [enId, jpId].sort());
  // A set+number the catalog does not have: no throw, no fallback candidates, no match.
  const none = pipeline.matchEvidence({ lines: [], printingLines: ['0404', 'SOC • EN'] });
  assert.deepEqual(none.candidates, []);
  assert.equal(none.method, 'none');
});
test('ScanPipeline.matchEvidence: a strong existing name match is never touched by the footer fallback', () => {
  const pipeline = new ScanPipeline(new CardIndex(footerBundle), { readText: async () => ({ lines: [] }) });
  // Exact name match with NO footer lines at all: nothing for the fallback to consult,
  // and the top score already clears 0.78, so it would not run even if it had evidence.
  const exact = pipeline.matchEvidence({ lines: ['Lightning Bolt'] });
  assert.equal(exact.candidates[0]!.score, 1);
  assert.ok(exact.candidates[0]!.score >= 0.78, 'above the bar: the fallback never even runs');
  // Name search already finds "Lightning Bolt" (enId) at full confidence, and the
  // footer names that SAME spot (SOC #236) -- the Japanese printing (jpId) sits at
  // the identical set+number and, per the two tests above, IS reachable through the
  // footer fallback when it runs. Here the top match already clears 0.78, so the
  // fallback must never run at all, and jpId (whose own `name` never matches
  // "Lightning Bolt") must not appear.
  const withFooter = pipeline.matchEvidence({ lines: ['Lightning Bolt'], printingLines: ['0236', 'SOC • EN'] });
  // enId and otherId both share the name "Lightning Bolt" -- otherId is a
  // legitimate name match (a different printing of the same card), just not
  // the footer-confirmed one. jpId is the one that only the fallback could add.
  assert.deepEqual(withFooter.candidates.map(c => c.printing.id).sort(), [enId, otherId].sort());
  assert.ok(!withFooter.candidates.some(c => c.printing.id === jpId), 'the footer fallback never ran: jpId is unreachable by name alone');
});
test('searchWithTotal reports the true match count ahead of truncation', () => {
  const index = new CardIndex(bundle);
  const { results, total } = index.searchWithTotal('Lightning Bolt', {}, {}, 1);
  assert.equal(total, 2, 'both printings match by name');
  assert.equal(results.length, 1, 'the returned page still honours the limit');
  const filtered = index.searchWithTotal('Lightning Bolt', {}, { setCode: 'sta' });
  assert.equal(filtered.total, 1);
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
test('matchEvidence ranks already-read text the same way a URI scan does, without ports', async () => {
  const evidence = {lines:['Lightning Bolt'],printingLines:['STA 42 · EN']};
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:async()=>evidence});
  const direct = pipeline.matchEvidence(evidence);
  const viaScan = await pipeline.scan('file:///photo',new AbortController().signal);
  assert.deepEqual(direct.candidates.map(c=>c.printing.id),viaScan.candidates.map(c=>c.printing.id));
  // The printing line is a hint, so the STA printing leads without the m11 one being dropped.
  assert.equal(direct.candidates[0]?.printing.id,b);
  assert.equal(direct.candidates[0]?.evidence,'printing');
  assert.equal(direct.candidates.length,2);
  assert.equal(direct.method,'ocr');
  assert.equal(direct.needsReview,true);
});
test('matchEvidence reports no match rather than guessing, and is reentrant', () => {
  const pipeline = new ScanPipeline(new CardIndex(bundle),{readText:async()=>({lines:[]})});
  assert.deepEqual(pipeline.matchEvidence({lines:[]}),{candidates:[],method:'none',needsReview:true,warnings:[]});
  assert.equal(pipeline.matchEvidence({lines:['Qqqqzzz Not A Card']}).method,'none');
  // No single-flight lock: the live scanner may match a second read while a
  // URI-based scan is still awaiting native OCR.
  assert.equal(scanBand(pipeline.matchEvidence({lines:['Lightning Bolt']}).candidates),'uncertain');
  assert.equal(pipeline.matchEvidence({lines:['Lightning Bolt'],printingLines:['M11 146']}).candidates[0]?.printing.id,a);
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

// ---------------------------------------------------------------------------
// createReprintWriter (mobile parity: apply_stack_reprint, migration 39)
// ---------------------------------------------------------------------------
const reprintOp = '66666666-6666-4666-8666-666666666666';
const reprintDraft: StackReprintDraft = {
  sourceInstanceId: 'source-row', newCardId: b, condition: 'NM', finish: 'nonfoil', language: 'en',
  quantity: 2, locationId: 'deck-1', notes: null,
};
const staleReprintSourceMessage = 'That copy no longer matches what was decided -- it may have moved, been edited, changed quantity, or no longer be yours';
const staleReprintDestinationMessage = 'That destination stack no longer matches the decided target -- it may have moved, been edited, or no longer be yours';

test('reprint writer decides a destination target from the store and applies through apply_stack_reprint', async () => {
  let applyCalls = 0;
  const store: ReprintStore = {
    findCandidates: async () => [{ id: 'dest-row', quantity: 3, notes: null }],
    applyStackReprint: async input => {
      applyCalls++;
      assert.equal(input.targetInstanceId, 'dest-row');
      assert.equal(input.sourceInstanceId, 'source-row');
      assert.equal(input.newCardId, b);
      assert.equal(input.operationId, reprintOp);
      return { instanceId: 'dest-row', quantity: 5, replayed: false };
    },
  };
  const writer = createReprintWriter(store);
  assert.deepEqual(
    await writer.save({ operationId: reprintOp, draft: reprintDraft }),
    { instanceId: 'dest-row', quantity: 5, replayed: false },
  );
  assert.equal(applyCalls, 1);
});

test('reprint writer updates in place when no destination candidate matches', async () => {
  const store: ReprintStore = {
    findCandidates: async () => [],
    applyStackReprint: async input => {
      assert.equal(input.targetInstanceId, null);
      return { instanceId: 'source-row', quantity: 2, replayed: false };
    },
  };
  const writer = createReprintWriter(store);
  assert.deepEqual(
    await writer.save({ operationId: reprintOp, draft: reprintDraft }),
    { instanceId: 'source-row', quantity: 2, replayed: false },
  );
});

test('reprint writer replay returns the recorded result and applies exactly once', async () => {
  let applyCalls = 0;
  const store: ReprintStore = {
    findCandidates: async () => [],
    applyStackReprint: async () => { applyCalls++; return { instanceId: 'source-row', quantity: 2, replayed: true }; },
  };
  const writer = createReprintWriter(store);
  assert.deepEqual(
    await writer.save({ operationId: reprintOp, draft: reprintDraft }),
    { instanceId: 'source-row', quantity: 2, replayed: true },
  );
  assert.equal(applyCalls, 1, 'the writer makes exactly one call; the ledger is what stops a retry from re-applying');
});

test('reprint writer rejects a replay submitted with different details', async () => {
  const store: ReprintStore = {
    findCandidates: async () => [],
    applyStackReprint: async () => { throw new Error('This operation was already submitted with different details'); },
  };
  const writer = createReprintWriter(store);
  await assert.rejects(writer.save({ operationId: reprintOp, draft: reprintDraft }), /different details/);
});

test('a stale DESTINATION target triggers exactly one automatic re-decide-and-retry with the same operation id', async () => {
  let findCalls = 0;
  let applyCalls = 0;
  const store: ReprintStore = {
    findCandidates: async () => {
      findCalls++;
      return findCalls === 1 ? [{ id: 'stale-dest', quantity: 3, notes: null }] : [{ id: 'fresh-dest', quantity: 5, notes: null }];
    },
    applyStackReprint: async input => {
      applyCalls++;
      assert.equal(input.operationId, reprintOp, 'a retry after a stale destination must reuse the same operation id');
      if (applyCalls === 1) {
        assert.equal(input.targetInstanceId, 'stale-dest');
        throw new Error(staleReprintDestinationMessage);
      }
      assert.equal(input.targetInstanceId, 'fresh-dest');
      return { instanceId: 'fresh-dest', quantity: 7, replayed: false };
    },
  };
  const writer = createReprintWriter(store);
  assert.deepEqual(
    await writer.save({ operationId: reprintOp, draft: reprintDraft }),
    { instanceId: 'fresh-dest', quantity: 7, replayed: false },
  );
  assert.equal(findCalls, 2);
  assert.equal(applyCalls, 2);
});

test('a second stale-destination response is surfaced to the caller, not retried again', async () => {
  const store: ReprintStore = {
    findCandidates: async () => [{ id: 'row', quantity: 1, notes: null }],
    applyStackReprint: async () => { throw new Error(staleReprintDestinationMessage); },
  };
  const writer = createReprintWriter(store);
  await assert.rejects(writer.save({ operationId: reprintOp, draft: reprintDraft }), /no longer matches the decided target/);
});

test('a stale SOURCE is retried once with the identical call, then surfaced if still stale', async () => {
  let applyCalls = 0;
  const store: ReprintStore = {
    findCandidates: async () => [{ id: 'dest-row', quantity: 3, notes: null }],
    applyStackReprint: async input => {
      applyCalls++;
      assert.equal(input.sourceInstanceId, 'source-row', 'a stale-source retry has nothing to re-decide about the source');
      if (applyCalls === 1) throw new Error(staleReprintSourceMessage);
      return { instanceId: 'dest-row', quantity: 5, replayed: false };
    },
  };
  const writer = createReprintWriter(store);
  assert.deepEqual(
    await writer.save({ operationId: reprintOp, draft: reprintDraft }),
    { instanceId: 'dest-row', quantity: 5, replayed: false },
  );
  assert.equal(applyCalls, 2, 'exactly one retry for a stale source, not unbounded retrying');
});

test('a second stale-source response is surfaced to the caller, not retried again', async () => {
  let applyCalls = 0;
  const store: ReprintStore = {
    findCandidates: async () => [],
    applyStackReprint: async () => { applyCalls++; throw new Error(staleReprintSourceMessage); },
  };
  const writer = createReprintWriter(store);
  await assert.rejects(writer.save({ operationId: reprintOp, draft: reprintDraft }), /no longer matches what was decided/);
  assert.equal(applyCalls, 2, 'one retry, then surfaced -- not retried a third time');
});

// ---------------------------------------------------------------------------
// buildCatalogRow (packages/scan-core/src/build-row.ts, used by
// scripts/build-catalog.ts) -- per-row validation, not all-or-nothing
// ---------------------------------------------------------------------------
const exportRow = {
  id: a, oracle_id: oracle, name: 'Lightning Bolt', flavor_name: null,
  set_code: 'm11', set_name: 'Magic 2011', collector_number: '146',
  available_finishes: ['nonfoil', 'foil'], lang: 'en', image_uri: null,
  digital: false, card_faces: null,
};

test('a valid export row builds a Printing, including the new optional bundle fields', () => {
  const printing = buildCatalogRow(exportRow, 1, new Set());
  assert.ok(printing && !('skipped' in printing));
  assert.equal((printing as { setCode: string }).setCode, 'm11');
  assert.equal((printing as { setName?: string }).setName, 'Magic 2011');
});

test('an unusable row is skipped and counted rather than throwing', () => {
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, available_finishes: undefined }, 2, new Set()));
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, id: 'not-a-uuid' }, 3, new Set()));
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, set_code: '' }, 4, new Set()));
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, available_finishes: ['surge_foil_from_the_future'] }, 5, new Set()));
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, digital: true }, 6, new Set()));
  // Found against the real Scryfall export while measuring this phase's build
  // (99,703 real rows): Un-set joke cards ("_____", Unhinged/Unknown Event)
  // have a name that is entirely punctuation, which normalizes to empty and
  // would otherwise fail parseCatalog's bundle-wide check with no row number.
  assert.ok('skipped' in buildCatalogRow({ ...exportRow, name: '_____' }, 7, new Set()));
});

test('a duplicate id within one build is skipped on its second occurrence, not silently overwritten', () => {
  const seen = new Set<string>();
  const first = buildCatalogRow(exportRow, 1, seen);
  const second = buildCatalogRow(exportRow, 2, seen);
  assert.ok(first && !('skipped' in first));
  assert.ok(second && 'skipped' in second);
});

test('card_faces names become aliases, and there is no printed_name branch to feed them from', () => {
  const printing = buildCatalogRow({
    ...exportRow,
    card_faces: [{ name: 'Front Face' }, { name: 'Back Face' }],
  }, 1, new Set());
  assert.ok(printing && !('skipped' in printing));
  assert.deepEqual((printing as { aliases: string[] }).aliases, ['Front Face', 'Back Face']);
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

test('scanBand classifies confident/uncertain/none the same way the mobile scanner UI does', () => {
  const strongTop: Candidate = { printing, score: 0.9, evidence: 'printing' };
  const weakTop: Candidate = { printing, score: 0.4, evidence: 'printing' };
  const nameOnlyTop: Candidate = { printing, score: 0.95, evidence: 'name' };
  assert.equal(scanBand([]), 'none');
  assert.equal(scanBand([strongTop]), 'confident');
  assert.equal(scanBand([weakTop]), 'uncertain', 'below the 0.78 threshold stays uncertain even with printing evidence');
  assert.equal(scanBand([nameOnlyTop]), 'uncertain', 'a high score alone is not enough -- must be printing evidence');
});

test('quickMatch: rejects a fuzzy name, accepts an exact one, and only trusts the printing when set+number matched', () => {
  const mk = (score: number, evidence: 'name' | 'printing', oracleId = oracle): Candidate => ({ printing: { ...printing, oracleId }, score, evidence });
  assert.deepEqual(quickMatch([]), { ok: false, reason: 'none' });
  // A 0.6 fuzzy match is "uncertain" for the scanner UI but far too weak to open unreviewed.
  assert.deepEqual(quickMatch([mk(0.6, 'name')]), { ok: false, reason: 'weak' });
  const exact = quickMatch([mk(1, 'name')]);
  assert.equal(exact.ok && exact.exactPrinting, false);
  const withPrinting = quickMatch([mk(0.9, 'printing')]);
  assert.equal(withPrinting.ok && withPrinting.exactPrinting, true);
  // A close-but-not-exact name with a different card nearly as good is a coin flip, not a match.
  const other = '55555555-5555-4555-8555-555555555555';
  assert.deepEqual(quickMatch([mk(0.9, 'name'), mk(0.88, 'name', other)]), { ok: false, reason: 'ambiguous' });
  // Same card, other printings, is not ambiguity.
  assert.equal(quickMatch([mk(0.9, 'name'), mk(0.9, 'name')]).ok, true);
});

test('quick-scan rejection hints stay silent at first, then give advice the person can act on', () => {
  // Never what was read or why: the first tries show nothing beyond the coaching line.
  for (let attempt = 0; attempt < QUICK_RETRY_CAP; attempt++) assert.equal(quickRejectionHint(attempt), '');
  // Past the cap the wording is advice, alternating so it does not read as stuck.
  assert.equal(quickRejectionHint(QUICK_RETRY_CAP), QUICK_LIGHT_HINT);
  assert.equal(quickRejectionHint(QUICK_RETRY_CAP + 1), QUICK_GLARE_HINT);
  assert.equal(quickRejectionHint(QUICK_RETRY_CAP + 2), QUICK_LIGHT_HINT);
});
test('readTitle uses lines 0-1 only and trims to the limit with an ellipsis', () => {
  assert.equal(readTitle(['Lightning Bolt', 'Instant', 'Deals 3 damage']), 'Lightning Bolt Instant');
  const long = readTitle(['A very long card title that goes on and on']);
  assert.equal(long.length, 28);
  assert.ok(long.endsWith('…'));
});
test('describeRejection reports the top candidate for the dev log', () => {
  const mk = (score: number): Candidate => ({ printing, score, evidence: 'name' });
  assert.deepEqual(describeRejection('weak', ['Lightning Bolt'], [mk(0.6123456)]), { reason: 'weak', title: 'Lightning Bolt', top: { name: 'Lightning Bolt', score: 0.612, evidence: 'name' }, candidates: 1 });
  assert.equal(describeRejection('none', [], []).top, null);
});
