import { stubModule } from './stubs';
Object.assign(globalThis, { __DEV__: false });
export const catalogDisk = new Map<string, { text: string; modified: number }>();
export const catalogReads: string[] = [];
export const catalogErrors: unknown[] = [];
export let readGate: Promise<void> | null = null;
export function gateReads(gate: Promise<void> | null) { readGate = gate; }
class File {
  uri: string;
  constructor(base: string, name?: string) { this.uri = name ? `${base}/${name}` : base; }
  get exists() { return catalogDisk.has(this.uri); }
  get modificationTime() { return catalogDisk.get(this.uri)?.modified ?? null; }
  async text() {
    catalogReads.push(this.uri);
    if (readGate) await readGate;
    const entry = catalogDisk.get(this.uri);
    if (!entry) throw Error('missing file');
    return entry.text;
  }
  write(text: string) { catalogDisk.set(this.uri, { text, modified: Date.now() }); }
}
stubModule('expo-file-system', { File, Paths: { document: 'file:///document' } });
stubModule('expo-asset', { Asset: { fromModule: () => ({ localUri: 'file:///snapshot', downloadAsync: async () => {} }) } });
stubModule('../assets/catalog-snapshot.db', 1 as unknown as object);
stubModule('expo/fetch', { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) });
stubModule('./errors', { reportError: (error: unknown) => catalogErrors.push(error) });
