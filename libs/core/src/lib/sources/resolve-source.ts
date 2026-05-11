import { Store } from 'n3';
import { parseGraphNameTransform } from './graph-name-transform';
import { loadRdf, type GraphMode, type LoadResult } from '../engine';
import {
  type ParsedEndpointSource,
  type ParsedGlobSource,
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';
import { applyTransformPipeline } from './transform-pipeline';
import type { ParsedTransform } from './transform-spec';
import { resolveView, type ResolveViewOptions } from '../view-resolver';

export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
    };

export interface ResolveSourceOptions {
  /**
   * Default `graphName` mode applied when a glob target has no `transforms`
   * declared. Synthesizes `[{ graphName: <mode> }]` for the target. Sources
   * that already declare `transforms` are passed through unchanged. Reserved
   * for programmatic callers — the CLI no longer exposes a top-level flag for
   * this; graph-name semantics belong on a glob source's `transforms` (#135).
   */
  graphMode?: GraphMode;
  /**
   * Registry of sibling source-specs. Required when the target is a view, so
   * its `from:` chain can be walked. Untargeted entries are never opened.
   */
  registry?: ReadonlyArray<ParsedSource>;
  /** Forwarded to view resolution when the target is (or descends to) a view. */
  cacheDir?: ResolveViewOptions['cacheDir'];
  /** Forwarded to view resolution. */
  now?: ResolveViewOptions['now'];
  /** Forwarded to view resolution. */
  engine?: ResolveViewOptions['engine'];
}

export async function resolveSource(
  target: ParsedSource,
  options: ResolveSourceOptions = {},
): Promise<QuerySources> {
  if (target.kind === 'reference') {
    throw new Error(
      "resolveSource: `kind: 'reference'` entries are aliases, not data, and cannot be resolved as a target",
    );
  }
  if (target.kind === 'endpoint') {
    return { mode: 'pass-through', endpoint: target };
  }
  if (target.kind === 'empty') {
    return materialized(new Store(), [], {});
  }
  if (target.kind === 'glob') {
    const loaded = await loadGlobIntoStore(target, options.graphMode);
    return materialized(loaded.store, loaded.files, loaded.prefixes);
  }
  return resolveViewTarget(target, options);
}

async function resolveViewTarget(
  view: ParsedViewSource,
  options: ResolveSourceOptions,
): Promise<QuerySources> {
  const registry = options.registry ?? [view];
  const store = await resolveView({
    view,
    registry,
    cacheDir: options.cacheDir,
    now: options.now,
    engine: options.engine,
  });
  return materialized(store, [], {});
}

async function loadGlobIntoStore(
  source: ParsedGlobSource,
  defaultGraphMode: GraphMode | undefined,
): Promise<LoadResult> {
  const sub = await loadRdf({ sources: source.glob });
  const transforms = effectiveTransforms(source, defaultGraphMode);
  const transformed = applyTransformPipeline(sub.store, transforms, {
    perFileRecords: sub.perFileRecords,
  });
  return {
    store: transformed,
    files: [...sub.files],
    prefixes: { ...sub.prefixes },
    perFileRecords: sub.perFileRecords,
  };
}

function effectiveTransforms(
  source: ParsedGlobSource,
  defaultGraphMode: GraphMode | undefined,
): ReadonlyArray<ParsedTransform> {
  if (source.transforms !== undefined) return source.transforms;
  if (defaultGraphMode === undefined || defaultGraphMode === 'preserve') {
    return [];
  }
  return [
    { key: 'graphName', apply: parseGraphNameTransform(defaultGraphMode) },
  ];
}

function materialized(
  store: Store,
  files: string[],
  prefixes: Record<string, Record<string, string>>,
): QuerySources {
  return { mode: 'materialized', store, files, prefixes };
}

