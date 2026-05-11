import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { Parser, Store, Writer, type Quad } from 'n3';
import {
  type ParsedSource,
  type ParsedViewSource,
} from './sources';

export type CacheFreshness = 'fresh' | 'stale' | 'miss';

export interface ViewCacheBinding {
  view: ParsedViewSource;
  upstream: ReadonlyArray<ParsedSource>;
  cacheDir: string;
  now?: () => number;
  /**
   * Optional. When supplied, `viewCacheKey` walks the view DAG via `from:` refs
   * and folds each upstream view's recursive cache key into the parent's key,
   * so a deep ancestor's spec change propagates. Without it, only the directly
   * supplied `upstream` specs feed the key.
   */
  registry?: ReadonlyArray<ParsedSource>;
  /**
   * Required when `view.cache.strategy === 'freshness'`. Lazily produces the
   * store the ASK probe runs against — typically the resolved upstream.
   */
  loadProbeStore?: () => Promise<Store>;
}

export interface ViewCacheLookup {
  freshness: CacheFreshness;
  store?: Store;
}

interface CacheMetaTtl {
  strategy: 'ttl';
  id: string;
  key: string;
  storedAt: number;
  ttlMs: number;
}

interface CacheMetaFreshness {
  strategy: 'freshness';
  id: string;
  key: string;
  storedAt: number;
}

interface CacheMetaEverlasting {
  strategy: 'everlasting';
  id: string;
  key: string;
  storedAt: number;
}

type CacheMeta = CacheMetaTtl | CacheMetaFreshness | CacheMetaEverlasting;

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
  return computeViewCacheKey(binding, []);
}

function computeViewCacheKey(
  binding: ViewCacheBinding,
  stack: ReadonlyArray<string>,
): string {
  const queryText =
    binding.view.query !== undefined
      ? `q:${binding.view.query}`
      : `qf:${binding.view.queryFile ?? ''}`;
  const upstreamContribs = upstreamKeyContributions(binding, stack);
  const material = [
    `view:${binding.view.id}`,
    `from:${binding.view.from}`,
    queryText,
    `upstream:\n${upstreamContribs.join('\n')}`,
  ].join('\n');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

function upstreamKeyContributions(
  binding: ViewCacheBinding,
  stack: ReadonlyArray<string>,
): string[] {
  if (binding.registry !== undefined) {
    return upstreamContribsViaRegistry(binding.view, binding.registry, stack);
  }
  return [...binding.upstream]
    .map((s) => stableStringify(s))
    .sort();
}

function indexRegistryById(
  registry: ReadonlyArray<ParsedSource>,
): Map<string, ParsedSource> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }
  return byId;
}

function upstreamContribsViaRegistry(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
): string[] {
  const byId = indexRegistryById(registry);
  const refId = view.from;
  if (stack.includes(refId)) {
    return [`cycle:${refId}`];
  }
  const upstream = byId.get(refId);
  if (!upstream) {
    return [`missing:${refId}`];
  }
  if (upstream.kind === 'view') {
    const subKey = computeViewCacheKey(
      {
        view: upstream,
        upstream: [],
        cacheDir: '',
        registry,
      },
      [...stack, view.id],
    );
    return [`view:${refId}:${subKey}`];
  }
  return [stableStringify(upstream)];
}

export async function lookup(
  binding: ViewCacheBinding,
): Promise<ViewCacheLookup> {
  const meta = await readMeta(binding);
  if (!meta) return { freshness: 'miss' };
  const dataPath = entryDataPath(binding);
  if (!(await fileExists(dataPath))) return { freshness: 'miss' };

  const timeFresh = isMetaTimeFresh(meta, binding.now ?? Date.now);
  if (!timeFresh) return { freshness: 'stale' };

  const store = await readCachedStore(dataPath);

  if (meta.strategy === 'freshness') {
    const askQuery = freshnessAskFor(binding);
    if (!askQuery) return { freshness: 'stale' };
    if (!binding.loadProbeStore) {
      throw new Error(
        `view "${binding.view.id}": cache.freshness requires a loadProbeStore callback on the binding`,
      );
    }
    const probeStore = await binding.loadProbeStore();
    const askPassed = await runAsk(askQuery, probeStore);
    if (!askPassed) return { freshness: 'stale' };
  }

  if (binding.registry !== undefined) {
    const ancestor = await ancestorFreshness(binding, [binding.view.id]);
    if (ancestor !== 'fresh') return { freshness: 'stale' };
  }

  return { freshness: 'fresh', store };
}

async function ancestorFreshness(
  binding: ViewCacheBinding,
  stack: ReadonlyArray<string>,
): Promise<CacheFreshness> {
  const registry = binding.registry;
  if (!registry) return 'fresh';
  const byId = indexRegistryById(registry);
  const refId = binding.view.from;
  if (stack.includes(refId)) return 'fresh';
  const upstream = byId.get(refId);
  if (!upstream || upstream.kind !== 'view') return 'fresh';
  const subBinding: ViewCacheBinding = {
    view: upstream,
    upstream: [],
    cacheDir: ancestorCacheDir(binding, upstream),
    registry,
    now: binding.now,
  };
  if (upstream.cache !== undefined) {
    // Skip freshness-ASK ancestors when no probe loader is plumbed:
    // their own resolver pass handles ASK probing, and asserting their
    // freshness here would require resolving their upstream — a coupling
    // we do not want from inside view-cache.
    if (
      upstream.cache.strategy === 'freshness' &&
      binding.loadProbeStore === undefined
    ) {
      return 'fresh';
    }
    const sub = await lookup(subBinding);
    return sub.freshness;
  }
  // Uncached intermediate view: keep walking upward.
  return ancestorFreshness(subBinding, [...stack, refId]);
}

function ancestorCacheDir(
  binding: ViewCacheBinding,
  upstream: ParsedViewSource,
): string {
  const override = upstream.cache?.cacheDir;
  if (override !== undefined && isAbsolute(override)) return override;
  return binding.cacheDir;
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
  const now = (binding.now ?? Date.now)();
  const meta = buildMeta(binding, now);
  await writeFile(entryMetaPath(binding), JSON.stringify(meta), 'utf8');
}

function buildMeta(binding: ViewCacheBinding, now: number): CacheMeta {
  const key = viewCacheKey(binding);
  const id = binding.view.id;
  const cache = binding.view.cache;
  if (cache?.strategy === 'freshness') {
    return { strategy: 'freshness', id, key, storedAt: now };
  }
  if (cache?.strategy === 'everlasting') {
    return { strategy: 'everlasting', id, key, storedAt: now };
  }
  // Default ttl: covers explicit ttl strategy and (defensively) any caller that
  // passes a binding with no cache block.
  const ttlMs = cache?.strategy === 'ttl' ? cache.ttlMs : 0;
  return { strategy: 'ttl', id, key, storedAt: now, ttlMs };
}

function freshnessAskFor(binding: ViewCacheBinding): string | undefined {
  const cache = binding.view.cache;
  if (cache?.strategy !== 'freshness') return undefined;
  return cache.freshness;
}

async function readCachedStore(dataPath: string): Promise<Store> {
  const nquads = await readFile(dataPath, 'utf8');
  const store = new Store();
  const parser = new Parser({ format: 'application/n-quads' });
  for (const q of parser.parse(nquads) as Quad[]) {
    store.addQuad(q);
  }
  return store;
}

async function runAsk(query: string, source: Store): Promise<boolean> {
  const engine = new ComunicaQueryEngine();
  const result = await engine.query(query, { sources: [source] });
  if (result.resultType !== 'boolean') {
    throw new Error(
      `cache.freshness query must be an ASK; got result type ${String(
        result.resultType,
      )}`,
    );
  }
  return (await result.execute()) as boolean;
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

function isMetaTimeFresh(meta: CacheMeta, now: () => number): boolean {
  if (meta.strategy === 'everlasting') return true;
  if (meta.strategy === 'freshness') return true;
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

export interface CachedEntrySummary {
  id: string;
  key: string;
  strategy: CacheMeta['strategy'];
  storedAt: number;
  ageMs: number;
  sizeBytes: number;
  freshness: CacheFreshness;
}

export interface ListCachedEntriesOptions {
  now?: () => number;
}

export async function listCachedEntries(
  cacheDir: string,
  opts: ListCachedEntriesOptions = {},
): Promise<CachedEntrySummary[]> {
  const now = opts.now ?? Date.now;
  const files = await readDirSafe(cacheDir);
  const entries: CachedEntrySummary[] = [];
  for (const name of files) {
    if (!name.endsWith('.meta.json')) continue;
    const metaPath = join(cacheDir, name);
    let meta: CacheMeta;
    try {
      const raw = await readFile(metaPath, 'utf8');
      meta = JSON.parse(raw) as CacheMeta;
    } catch {
      continue;
    }
    const dataPath = join(cacheDir, `${meta.key}.nq`);
    const [metaStat, dataStat] = await Promise.all([
      statSafe(metaPath),
      statSafe(dataPath),
    ]);
    const sizeBytes =
      (metaStat?.size ?? 0) + (dataStat?.size ?? 0);
    const nowMs = now();
    const fresh = isMetaTimeFresh(meta, () => nowMs)
      ? 'fresh'
      : 'stale';
    entries.push({
      id: meta.id,
      key: meta.key,
      strategy: meta.strategy,
      storedAt: meta.storedAt,
      ageMs: Math.max(0, nowMs - meta.storedAt),
      sizeBytes,
      freshness: fresh,
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries;
}

export async function clearCacheDir(cacheDir: string): Promise<number> {
  const entries = await listCachedEntries(cacheDir);
  for (const entry of entries) {
    await rm(join(cacheDir, `${entry.key}.nq`), { force: true });
    await rm(join(cacheDir, `${entry.key}.meta.json`), { force: true });
  }
  return entries.length;
}

export async function removeCacheEntry(
  cacheDir: string,
  id: string,
): Promise<void> {
  const entries = await listCachedEntries(cacheDir);
  const target = entries.find((e) => e.id === id);
  if (!target) {
    const known = entries.map((e) => e.id).sort();
    const knownStr = known.length === 0 ? '(none)' : known.join(', ');
    throw new Error(
      `no cached entry with id "${id}" under ${cacheDir} (known: ${knownStr})`,
    );
  }
  await rm(join(cacheDir, `${target.key}.nq`), { force: true });
  await rm(join(cacheDir, `${target.key}.meta.json`), { force: true });
}

async function readDirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function statSafe(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}
