import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { Parser, Store, Writer, type Quad } from 'n3';
import {
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';

export type CacheFreshness = 'fresh' | 'stale' | 'miss';

export interface ViewCacheBinding {
  view: ParsedViewSource;
  upstream: ReadonlyArray<ParsedSource>;
  cacheDir: string;
  now?: () => number;
}

export interface ViewCacheLookup {
  freshness: CacheFreshness;
  store?: Store;
}

interface CacheMeta {
  key: string;
  storedAt: number;
  ttlMs: number;
}

export interface ResolveViewCacheDirOptions {
  view: ParsedViewSource;
  configPath?: string;
}

export const DEFAULT_CACHE_DIR_NAME = '.sparqly/cache';

export function resolveViewCacheDir(
  opts: ResolveViewCacheDirOptions,
): string {
  const baseDir = opts.configPath ? dirname(opts.configPath) : process.cwd();
  const override = opts.view.cache?.cacheDir;
  if (override !== undefined) {
    return isAbsolute(override) ? override : resolvePath(baseDir, override);
  }
  return join(baseDir, DEFAULT_CACHE_DIR_NAME);
}

export function viewCacheKey(binding: ViewCacheBinding): string {
  const queryText =
    binding.view.query !== undefined
      ? `q:${binding.view.query}`
      : `qf:${binding.view.queryFile ?? ''}`;
  const upstream = [...binding.upstream]
    .map((s) => stableStringify(s))
    .sort()
    .join('\n');
  const fromRefs = [...binding.view.from].sort().join(',');
  const material = [
    `view:${binding.view.id}`,
    `from:${fromRefs}`,
    queryText,
    `upstream:\n${upstream}`,
  ].join('\n');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export async function lookup(
  binding: ViewCacheBinding,
): Promise<ViewCacheLookup> {
  const meta = await readMeta(binding);
  if (!meta) return { freshness: 'miss' };
  const fresh = isFresh(meta, binding.now ?? Date.now);
  if (!fresh) return { freshness: 'stale' };
  const dataPath = entryDataPath(binding);
  if (!(await fileExists(dataPath))) return { freshness: 'miss' };
  const nquads = await readFile(dataPath, 'utf8');
  const store = new Store();
  const parser = new Parser({ format: 'application/n-quads' });
  for (const q of parser.parse(nquads) as Quad[]) {
    store.addQuad(q);
  }
  return { freshness: 'fresh', store };
}

export async function storeView(
  binding: ViewCacheBinding,
  store: Store,
): Promise<void> {
  await mkdir(binding.cacheDir, { recursive: true });
  const quads = store.getQuads(null, null, null, null);
  const writer = new Writer({ format: 'application/n-quads' });
  let serialized = '';
  for (const q of quads) writer.addQuad(q);
  await new Promise<void>((resolve, reject) => {
    writer.end((err: Error | null | undefined, result: string) => {
      if (err) reject(err);
      else {
        serialized = result;
        resolve();
      }
    });
  });
  await writeFile(entryDataPath(binding), serialized, 'utf8');
  const ttlMs = binding.view.cache?.ttlMs ?? 0;
  const now = (binding.now ?? Date.now)();
  const meta: CacheMeta = {
    key: viewCacheKey(binding),
    storedAt: now,
    ttlMs,
  };
  await writeFile(entryMetaPath(binding), JSON.stringify(meta), 'utf8');
}

export async function invalidate(binding: ViewCacheBinding): Promise<void> {
  await rm(entryDataPath(binding), { force: true });
  await rm(entryMetaPath(binding), { force: true });
}

export async function freshness(
  binding: ViewCacheBinding,
): Promise<CacheFreshness> {
  return (await lookup(binding)).freshness;
}

function entryDataPath(binding: ViewCacheBinding): string {
  return join(binding.cacheDir, `${viewCacheKey(binding)}.nq`);
}

function entryMetaPath(binding: ViewCacheBinding): string {
  return join(binding.cacheDir, `${viewCacheKey(binding)}.meta.json`);
}

async function readMeta(
  binding: ViewCacheBinding,
): Promise<CacheMeta | undefined> {
  const path = entryMetaPath(binding);
  if (!(await fileExists(path))) return undefined;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as CacheMeta;
}

function isFresh(meta: CacheMeta, now: () => number): boolean {
  if (meta.ttlMs <= 0) return false;
  return now() - meta.storedAt < meta.ttlMs;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}
