import { DataFactory, Store } from 'n3';
import { loadRdf, type GraphMode, type LoadResult } from './rdf-loader';
import {
  type ParsedEndpointSource,
  type ParsedGlobSource,
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';
import { resolveView, type ResolveViewOptions } from './view-resolver';

export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
    };

export interface ResolveSourceOptions {
  /** Default per-source graphMode for glob loads. */
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
  const merged = new Store();
  const effectiveMode: GraphMode =
    source.graphMode ?? defaultGraphMode ?? 'preserve';
  const overrideGraph = source.graph
    ? DataFactory.namedNode(source.graph)
    : undefined;

  const sub = await loadRdf({
    sources: source.glob,
    graphMode: effectiveMode,
  });
  const fileSyntheticIris = new Set(sub.files.map((f) => `file://${f}`));
  for (const quad of sub.store.getQuads(null, null, null, null)) {
    const rewritten =
      overrideGraph &&
      quad.graph.termType === 'NamedNode' &&
      fileSyntheticIris.has(quad.graph.value)
        ? DataFactory.quad(
            quad.subject,
            quad.predicate,
            quad.object,
            overrideGraph,
          )
        : quad;
    merged.addQuad(rewritten);
  }
  return { store: merged, files: [...sub.files], prefixes: { ...sub.prefixes } };
}

function materialized(
  store: Store,
  files: string[],
  prefixes: Record<string, Record<string, string>>,
): QuerySources {
  return { mode: 'materialized', store, files, prefixes };
}

