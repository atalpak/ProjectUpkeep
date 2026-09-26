import { stubModule } from './stubs';

// An in-memory stand-in for the slice of expo-file-system that
// printingVerify.ts uses (Directory, File, Paths, File.downloadFileAsync), and
// for the native `@upkeep/vision` ranking call. Files are entries in one map
// keyed by uri, so a test can pre-seed the cache, script a download to fail or
// stall, and afterwards look at exactly what is left on "disk".

export type Entry = { size: number; modificationTime: number | null };

export const disk = {
  files: new Map<string, Entry>(),
  dirs: new Set<string>(),
  /** Every url a download was started for, in order. */
  downloads: [] as string[],
  /** Replace to make a download slow, empty or failing. Default: a 100-byte file. */
  onDownload: async (_url: string, dest: FakeFile): Promise<FakeFile> => { disk.files.set(dest.uri, { size: 100, modificationTime: Date.now() }); return dest; },
  reset(): void {
    disk.files.clear();
    disk.dirs.clear();
    disk.downloads.length = 0;
    disk.onDownload = async (_url, dest) => { disk.files.set(dest.uri, { size: 100, modificationTime: Date.now() }); return dest; };
  },
};

const join = (base: FakeDirectory | string, name?: string): string => {
  const root = typeof base === 'string' ? base : base.uri;
  return name === undefined ? root : `${root}/${name}`;
};

class FakeFile {
  readonly uri: string;
  constructor(base: FakeDirectory | string, name?: string) { this.uri = join(base, name); }
  get exists(): boolean { return disk.files.has(this.uri); }
  get size(): number { return disk.files.get(this.uri)?.size ?? 0; }
  get modificationTime(): number | null { return disk.files.get(this.uri)?.modificationTime ?? null; }
  delete(): void { disk.files.delete(this.uri); }
  move(dest: FakeFile): void {
    const entry = disk.files.get(this.uri);
    if (!entry) throw new Error('nothing to move');
    disk.files.delete(this.uri);
    disk.files.set(dest.uri, entry);
  }
  static async downloadFileAsync(url: string, dest: FakeFile): Promise<FakeFile> {
    disk.downloads.push(url);
    return disk.onDownload(url, dest);
  }
}

class FakeDirectory {
  readonly uri: string;
  constructor(base: FakeDirectory | string, name?: string) { this.uri = join(base, name); }
  get exists(): boolean { return disk.dirs.has(this.uri); }
  create(): void { disk.dirs.add(this.uri); }
  list(): FakeFile[] { return [...disk.files.keys()].filter(uri => uri.startsWith(`${this.uri}/`)).map(uri => new FakeFile(uri)); }
}

stubModule('expo-file-system', { Directory: FakeDirectory, File: FakeFile, Paths: { cache: new FakeDirectory('file:///cache') } });

export const vision = {
  available: true,
  calls: [] as { photo: string; refs: string[] }[],
  /** Distances line up with `refs`; return null for "could not compare". */
  rank: async (_photo: string, refs: string[]): Promise<number[] | null> => refs.map((_, i) => (i + 1) / 10),
  reset(): void {
    vision.available = true;
    vision.calls.length = 0;
    vision.rank = async (_photo, refs) => refs.map((_, i) => (i + 1) / 10);
  },
};

stubModule('@upkeep/vision', {
  get cardImageRankingAvailable() { return vision.available; },
  rankCardImage: (photo: string, refs: string[]) => { vision.calls.push({ photo, refs }); return vision.rank(photo, refs); },
});

export type { FakeFile };
