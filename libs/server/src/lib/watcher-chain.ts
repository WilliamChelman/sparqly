import { isAbsolute, resolve } from 'node:path';
import type { ParsedSource, ParsedViewSource } from 'core';

export interface WatcherSourcePlan {
  /** Source `@id`. `undefined` for inline single-source targets without an id. */
  id: string | undefined;
  /** The source itself (root of this chain). */
  source: ParsedSource;
  /** Glob patterns reachable from this source through the `from:` chain. */
  globs: ReadonlyArray<string>;
  /** Deduped chokidar base directories for this source's globs. */
  globBases: ReadonlyArray<string>;
  /** All views in this source's chain (root included if it is a view). */
  views: ReadonlyArray<ParsedViewSource>;
  /** Views whose `cache.ttl`/`cache.freshness` timers/probes should run under `--watch`. */
  cachedViews: ReadonlyArray<ParsedViewSource>;
  /** Registry slice covering this source's chain — sufficient for freshness probes. */
  chain: ReadonlyArray<ParsedSource>;
}

export interface WatcherChain {
  /** Per-source watch plans for sources that have something to watch. */
  sources: ReadonlyArray<WatcherSourcePlan>;
  /**
   * Sources that have nothing to watch (raw endpoints, views-on-endpoint
   * without a TTL/freshness cache, everlasting-cached views, bare empty
   * sources). The caller emits the per-source `--watch ignored` warning.
   */
  passThrough: ReadonlyArray<ParsedSource>;
  /**
   * Globs across every source's chain, deduped to base directories — drives a
   * single chokidar instance regardless of how many sources reference them.
   */
  globBases: ReadonlyArray<string>;
}

export function buildWatcherChain(
  servedRegistry: ReadonlyArray<ParsedSource>,
  resolutionRegistry: ReadonlyArray<ParsedSource> = servedRegistry,
): WatcherChain {
  const byId = new Map<string, ParsedSource>();
  for (const src of resolutionRegistry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }

  const sources: WatcherSourcePlan[] = [];
  const passThrough: ParsedSource[] = [];

  for (const src of servedRegistry) {
    if (src.kind === 'reference') continue;
    const plan = buildSourcePlan(src, byId);
    if (planNeedsWatching(plan)) {
      sources.push(plan);
    } else {
      passThrough.push(src);
    }
  }

  const globBases = dedupeBases(
    sources.flatMap((plan) => plan.globBases as string[]),
  );

  return { sources, passThrough, globBases };
}

function buildSourcePlan(
  source: ParsedSource,
  byId: ReadonlyMap<string, ParsedSource>,
): WatcherSourcePlan {
  const chain: ParsedSource[] = [];
  const globs: string[] = [];
  const views: ParsedViewSource[] = [];
  const cachedViews: ParsedViewSource[] = [];
  const seen = new Set<ParsedSource>();

  const visit = (node: ParsedSource): void => {
    if (seen.has(node)) return;
    seen.add(node);
    chain.push(node);
    if (node.kind === 'glob') {
      globs.push(node.glob);
      return;
    }
    if (node.kind === 'view') {
      views.push(node);
      const cache = node.cache;
      if (cache?.strategy === 'ttl' || cache?.strategy === 'freshness') {
        cachedViews.push(node);
      }
      const upstream = byId.get(node.from);
      if (upstream !== undefined) visit(upstream);
    }
  };

  visit(source);

  const globBases = dedupeBases(globs.map(globBase));

  return {
    id: 'id' in source ? source.id : undefined,
    source,
    globs,
    globBases,
    views,
    cachedViews,
    chain,
  };
}

function planNeedsWatching(plan: WatcherSourcePlan): boolean {
  return plan.globs.length > 0 || plan.cachedViews.length > 0;
}

function dedupeBases(bases: ReadonlyArray<string>): string[] {
  return Array.from(new Set(bases));
}

export function globBase(pattern: string): string {
  const isAbs = isAbsolute(pattern);
  const segments = pattern.split(/[\\/]+/);
  const out: string[] = [];
  for (const seg of segments) {
    if (/[*?[\]{}!()]/.test(seg)) break;
    out.push(seg);
  }
  const joined = out.join('/');
  if (joined === '' || joined === '.') return resolve('.');
  if (!isAbs) return resolve(joined);
  if (out.length === 1 && out[0] === '') return '/';
  return joined;
}
