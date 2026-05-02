import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import { loadEndpointToStore } from './endpoint-load';
import { loadRdf } from './rdf-loader';
import {
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';
import {
  lookup as cacheLookup,
  storeView as cacheStore,
  type ViewCacheBinding,
} from './view-cache';
import { validateViewQuery } from './view-query-validate';

export interface ResolveViewOptions {
  view: ParsedViewSource;
  registry: ReadonlyArray<ParsedSource>;
  /**
   * Absolute directory used for persistent caching of views that declare a
   * `cache` block. When omitted, the cache is skipped (lazy + process-lifetime
   * materialization only). Anonymous CLI views always omit this.
   */
  cacheDir?: string;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export async function resolveView(
  opts: ResolveViewOptions,
): Promise<Store> {
  const { view, registry, cacheDir, now } = opts;
  if (view.cache && cacheDir) {
    const upstream = collectCacheUpstream(view, registry);
    const binding: ViewCacheBinding = {
      view,
      upstream,
      cacheDir,
      now,
      loadProbeStore:
        view.cache.strategy === 'freshness'
          ? () => loadUpstream(view, registry, [view.id])
          : undefined,
    };
    const hit = await cacheLookup(binding);
    if (hit.freshness === 'fresh' && hit.store) {
      return hit.store;
    }
    const fresh = await resolveViewInternal(view, registry, [view.id]);
    await cacheStore(binding, fresh);
    return fresh;
  }
  return resolveViewInternal(view, registry, [view.id]);
}

function collectCacheUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
): ReadonlyArray<ParsedSource> {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }
  const out: ParsedSource[] = [];
  for (const refId of view.from) {
    const upstream = byId.get(refId);
    if (upstream) out.push(upstream);
  }
  return out;
}

async function resolveViewInternal(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
): Promise<Store> {
  const query = await loadViewQuery(view);
  validateViewQuery(query);
  const upstreamStore = await loadUpstream(view, registry, stack);
  return runViewQuery(upstreamStore, query);
}

async function loadViewQuery(view: ParsedViewSource): Promise<string> {
  if (view.query !== undefined) return view.query;
  if (view.queryFile !== undefined) {
    const path = resolvePath(process.cwd(), view.queryFile);
    return readFile(path, 'utf8');
  }
  throw new Error(
    `view "${view.id}": exactly one of \`query\` or \`queryFile\` is required`,
  );
}

async function loadUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
): Promise<Store> {
  const merged = new Store();
  const byId = buildRegistryById(registry);
  for (const refId of view.from) {
    if (stack.includes(refId)) {
      throw new Error(
        `view "${view.id}": cycle detected on \`from:\` ref @${refId} (chain: ${stack
          .map((id) => `@${id}`)
          .join(' -> ')} -> @${refId})`,
      );
    }
    const upstream = byId.get(refId);
    if (!upstream) {
      const known = [...byId.keys()];
      const list =
        known.length === 0 ? '<none>' : known.map((k) => `@${k}`).join(', ');
      throw new Error(
        `view "${view.id}": unknown @id reference "@${refId}"; defined ids: ${list}`,
      );
    }
    if (upstream.kind === 'reference') {
      throw new Error(
        `view "${view.id}": reference upstream "@${refId}" is not yet supported`,
      );
    }
    if (upstream.kind === 'view') {
      const sub = await resolveViewInternal(upstream, registry, [
        ...stack,
        refId,
      ]);
      for (const quad of sub.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }
    if (upstream.kind === 'endpoint') {
      const sub = await loadEndpointToStore(upstream);
      for (const quad of sub.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }
    const sub = await loadRdf({
      sources: upstream.glob,
      graphMode: upstream.graphMode ?? 'preserve',
    });
    for (const quad of sub.store.getQuads(null, null, null, null)) {
      merged.addQuad(quad);
    }
  }
  return merged;
}

function buildRegistryById(
  registry: ReadonlyArray<ParsedSource>,
): Map<string, ParsedSource> {
  const map = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    map.set(src.id, src);
  }
  return map;
}

async function runViewQuery(
  source: Store,
  query: string,
): Promise<Store> {
  const engine = new ComunicaQueryEngine();
  const out = new Store();
  const result = await engine.query(query, { sources: [source] });
  if (result.resultType === 'bindings') {
    const bindings = await result.execute();
    for await (const b of bindings as AsyncIterable<{
      get(name: string): Quad['subject'] | Quad['predicate'] | Quad['object'] | undefined;
    }>) {
      const s = b.get('s');
      const p = b.get('p');
      const o = b.get('o');
      const g = b.get('g');
      if (!s || !p || !o) continue;
      const graph = g ? (g as Quad['graph']) : DataFactory.defaultGraph();
      out.addQuad(
        DataFactory.quad(
          s as Quad['subject'],
          p as Quad['predicate'],
          o as Quad['object'],
          graph,
        ),
      );
    }
    return out;
  }
  if (result.resultType === 'quads') {
    const quads = await result.execute();
    for await (const q of quads as AsyncIterable<Quad>) {
      out.addQuad(q);
    }
    return out;
  }
  throw new Error(
    `view query produced unexpected result type: ${String(result.resultType)}`,
  );
}
