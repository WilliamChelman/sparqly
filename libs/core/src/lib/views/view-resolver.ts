import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import type { SparqlyLogger } from 'common';
import { emitQueryEvent, loadRdf } from '../engine';
import { detectQueryType } from '../canonical/immutability';
import { applyTransformPipeline } from '../sources';
import {
  type ParsedEndpointSource,
  type ParsedSource,
  type ParsedViewSource,
} from '../sources';
import {
  lookup as cacheLookup,
  storeView as cacheStore,
  type ViewCacheBinding,
} from './view-cache';
import {
  resolveViewPassThrough,
  type ViewQueryLogMeta,
} from './view-pass-through';
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
  /** Test seam: inject a Comunica engine. */
  engine?: ComunicaQueryEngine;
  /**
   * When set, each SPARQL execution along the `from:` chain emits a `query`
   * debug event (`mode=view`) on this logger — same shape as `sparqly query`
   * (ADR-0020).
   */
  logger?: SparqlyLogger;
}

export async function resolveView(opts: ResolveViewOptions): Promise<Store> {
  return resolveViewWithCache(
    opts.view,
    opts.registry,
    [opts.view.id],
    opts.cacheDir,
    opts.now,
    opts.engine,
    opts.logger,
  );
}

async function resolveViewWithCache(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
): Promise<Store> {
  if (view.cache && cacheDir) {
    const upstream = collectCacheUpstream(view, registry);
    const binding: ViewCacheBinding = {
      view,
      upstream,
      cacheDir,
      now,
      registry,
      loadProbeStore:
        view.cache.strategy === 'freshness'
          ? () =>
              loadUpstream(view, registry, stack, cacheDir, now, engine, logger)
          : undefined,
    };
    const hit = await cacheLookup(binding);
    if (hit.freshness === 'fresh' && hit.store) {
      return hit.store;
    }
    const fresh = await resolveViewInternal(
      view,
      registry,
      stack,
      cacheDir,
      now,
      engine,
      logger,
    );
    await cacheStore(binding, fresh);
    return fresh;
  }
  return resolveViewInternal(
    view,
    registry,
    stack,
    cacheDir,
    now,
    engine,
    logger,
  );
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
  const upstream = byId.get(view.from);
  return upstream ? [upstream] : [];
}

async function resolveViewInternal(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
): Promise<Store> {
  const query = await loadViewQuery(view);
  validateViewQuery(query);
  const meta = { source: view.id, logger };
  const singleEndpoint = singleEndpointUpstream(view, registry);
  if (singleEndpoint) {
    return resolveViewPassThrough({
      endpoint: singleEndpoint,
      viewQuery: query,
      engine,
      meta,
    });
  }
  const upstreamStore = await loadUpstream(
    view,
    registry,
    stack,
    cacheDir,
    now,
    engine,
    logger,
  );
  return runViewQuery(upstreamStore, query, engine, meta);
}

function singleEndpointUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
): ParsedEndpointSource | undefined {
  const byId = buildRegistryById(registry);
  const upstream = byId.get(view.from);
  if (!upstream || upstream.kind !== 'endpoint') return undefined;
  return upstream;
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
  cacheDir: string | undefined,
  now: (() => number) | undefined,
  engine: ComunicaQueryEngine | undefined,
  logger: SparqlyLogger | undefined,
): Promise<Store> {
  const refId = view.from;
  const byId = buildRegistryById(registry);
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
    return resolveViewWithCache(
      upstream,
      registry,
      [...stack, refId],
      cacheDir,
      now,
      engine,
      logger,
    );
  }
  if (upstream.kind === 'empty') {
    return new Store();
  }
  if (upstream.kind !== 'glob') {
    // Endpoint upstreams are routed via pass-through above; this branch is
    // unreachable for the current source kinds.
    throw new Error(
      `view "${view.id}": unexpected upstream kind "${(upstream as { kind: string }).kind}" for ref @${refId}`,
    );
  }
  const sub = await loadRdf({ sources: upstream.glob });
  return applyTransformPipeline(sub.store, upstream.transforms ?? [], {
    perFileRecords: sub.perFileRecords,
  });
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
  engine: ComunicaQueryEngine | undefined,
  meta: ViewQueryLogMeta,
): Promise<Store> {
  const e = engine ?? new ComunicaQueryEngine();
  const out = new Store();
  const started = Date.now();
  const type = detectQueryType(query);
  try {
    const result = await e.query(query, { sources: [source] });
    if (result.resultType === 'bindings') {
      const bindings = await result.execute();
      for await (const b of bindings as AsyncIterable<{
        get(
          name: string,
        ): Quad['subject'] | Quad['predicate'] | Quad['object'] | undefined;
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
    } else if (result.resultType === 'quads') {
      const quads = await result.execute();
      for await (const q of quads as AsyncIterable<Quad>) {
        out.addQuad(q);
      }
    } else {
      throw new Error(
        `view query produced unexpected result type: ${String(result.resultType)}`,
      );
    }
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      size: { quads: out.size },
    });
    return out;
  } catch (err) {
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      err,
    });
    throw err;
  }
}
