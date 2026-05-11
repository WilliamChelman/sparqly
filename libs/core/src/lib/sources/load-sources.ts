import { loadEndpointToStore } from '../engine';
import { resolveSource, type ResolveSourceOptions } from './resolve-source';
import { type LoadResult, type GraphMode } from '../engine';
import { type ParsedSource } from './source-spec';

export const NOT_SUPPORTED_TRACKING_URL =
  'https://github.com/WilliamChelman/sparqly/issues/60';

export interface LoadSourcesOptions {
  graphMode?: GraphMode;
  registry?: ResolveSourceOptions['registry'];
  cacheDir?: ResolveSourceOptions['cacheDir'];
  now?: ResolveSourceOptions['now'];
  engine?: ResolveSourceOptions['engine'];
}

/**
 * Load a single target source (and its `from:` chain, if any) into a Store.
 *
 * This is the always-materialize variant of {@link resolveSource}: endpoint
 * targets are eagerly fetched into a Store rather than handed back as a
 * pass-through reference. Use this when the caller needs concrete quads (e.g.
 * canonicalization, hashing, diffing). For query/serve, prefer
 * {@link resolveSource} so endpoint pass-through stays available.
 */
export async function loadSources(
  target: ParsedSource,
  options: LoadSourcesOptions = {},
): Promise<LoadResult> {
  if (target.kind === 'reference') {
    throw new Error(
      `@id reference sources are not yet supported (tracking: ${NOT_SUPPORTED_TRACKING_URL})`,
    );
  }

  if (target.kind === 'endpoint') {
    const store = await loadEndpointToStore(target);
    return { store, files: [], prefixes: {} };
  }

  const sources = await resolveSource(target, {
    graphMode: options.graphMode,
    registry: options.registry,
    cacheDir: options.cacheDir,
    now: options.now,
    engine: options.engine,
  });
  if (sources.mode === 'pass-through') {
    // Defensive: resolveSource only returns pass-through for endpoint targets,
    // which we handled above.
    const store = await loadEndpointToStore(sources.endpoint);
    return { store, files: [], prefixes: {} };
  }
  return {
    store: sources.store,
    files: sources.files,
    prefixes: sources.prefixes,
  };
}
