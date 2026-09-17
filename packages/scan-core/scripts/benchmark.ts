import { performance } from 'node:perf_hooks';
import { CardIndex, type CatalogBundle } from '../src';
const count = 50_000;
const bundle: CatalogBundle = {schemaVersion:1,version:'synthetic-benchmark',generatedAt:new Date().toISOString(),printings:
  Array.from({length:count},(_,i)=>({id:`00000000-0000-4000-8000-${i.toString().padStart(12,'0')}`,oracleId:`00000000-0000-4000-8000-${i.toString().padStart(12,'0')}`,name:`Arcane Guardian ${i}`,aliases:[],setCode:'tst',collectorNumber:String(i),finishes:['nonfoil'],language:'en'}))};
const before = process.memoryUsage().heapUsed;
const start = performance.now();
const index = new CardIndex(bundle);
const buildMs = performance.now()-start;
const measurements = Array.from({length:200},(_,i)=>{const t=performance.now();index.search(i%2 ? `Arcane Guardlan ${i}` : `Arcane Guardian ${i}`);return performance.now()-t;}).sort((a,b)=>a-b);
console.log(JSON.stringify({printings:count,buildMs:Math.round(buildMs),searchMedianMs:measurements[100],searchP95Ms:measurements[190],heapDeltaMB:(process.memoryUsage().heapUsed-before)/1024/1024,note:'Synthetic desktop Node benchmark. Not device OCR latency or accuracy.'},null,2));
