import type { ParsedSource, ParsedViewSource } from 'core';

export interface WatcherChain {
  /** Glob patterns reachable from the target through the `from:` chain. */
  globs: ReadonlyArray<string>;
  /** All views in the target's chain (target included if it is a view). */
  views: ReadonlyArray<ParsedViewSource>;
  /** Views whose `cache.ttl`/`cache.freshness` timers/probes should run under `--watch`. */
  cachedViews: ReadonlyArray<ParsedViewSource>;
  /** Registry slice covering the target chain — sufficient for freshness probes. */
  registry: ReadonlyArray<ParsedSource>;
}

export function buildWatcherChain(
  registry: ReadonlyArray<ParsedSource>,
  target: ParsedSource,
): WatcherChain {
  const byId = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference' || src.id === undefined) continue;
    byId.set(src.id, src);
  }

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

  visit(target);

  return { globs, views, cachedViews, registry: chain };
}
