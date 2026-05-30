import { isAbsolute, resolve } from 'node:path';
import type { ParsedSource } from 'core';

export interface WatcherSourcePlan {
  /** Source `@id`. `undefined` for inline single-source targets without an id. */
  id: string | undefined;
  /** The source itself. */
  source: ParsedSource;
  /** Glob/file patterns this source loads from. */
  globs: ReadonlyArray<string>;
  /** Deduped chokidar base directories for this source's globs. */
  globBases: ReadonlyArray<string>;
}

export interface WatcherChain {
  /** Per-source watch plans for sources that have something to watch. */
  sources: ReadonlyArray<WatcherSourcePlan>;
  /**
   * Sources that have nothing to watch (raw endpoints, bare empty sources).
   * The caller emits the per-source `--watch ignored` warning.
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
  // Retained for call-site compatibility; with the `view` source kind removed
  // there is no longer a `from:` chain to resolve across registries.
  _resolutionRegistry: ReadonlyArray<ParsedSource> = servedRegistry,
): WatcherChain {
  const sources: WatcherSourcePlan[] = [];
  const passThrough: ParsedSource[] = [];

  for (const src of servedRegistry) {
    if (src.kind === 'reference') continue;
    const plan = buildSourcePlan(src);
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

function buildSourcePlan(source: ParsedSource): WatcherSourcePlan {
  const globs: string[] = [];
  if (source.kind === 'glob') globs.push(source.glob);
  else if (source.kind === 'file') globs.push(source.path);

  const globBases = dedupeBases(globs.map(globBase));

  return {
    id: 'id' in source ? source.id : undefined,
    source,
    globs,
    globBases,
  };
}

function planNeedsWatching(plan: WatcherSourcePlan): boolean {
  return plan.globs.length > 0;
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
