import { DataFactory, Store, type Quad } from 'n3';
import { loadEndpointToStore } from './endpoint-load';
import { loadRdf, type GraphMode, type LoadResult } from './rdf-loader';
import {
  parseSourceSpecs,
  type ParseSourceSpecsContext,
  type ParsedEndpointSource,
  type ParsedGlobSource,
  type ParsedViewSource,
  type SourceSpecInput,
} from './source-spec';
import { resolveView } from './view-resolver';

export const NOT_SUPPORTED_TRACKING_URL =
  'https://github.com/WilliamChelman/sparqly/issues/60';

export interface LoadSourcesOptions {
  graphMode?: GraphMode;
  parseContext?: ParseSourceSpecsContext;
}

export async function loadSources(
  inputs: ReadonlyArray<SourceSpecInput>,
  options: LoadSourcesOptions = {},
): Promise<LoadResult> {
  const parsed = parseSourceSpecs(inputs, options.parseContext);
  for (const source of parsed) {
    if (source.kind === 'reference') {
      throw new Error(
        `@id reference sources are not yet supported (tracking: ${NOT_SUPPORTED_TRACKING_URL})`,
      );
    }
  }

  const merged = new Store();
  const allFiles: string[] = [];
  const allPrefixes: Record<string, Record<string, string>> = {};

  for (const rawSource of parsed) {
    if (rawSource.kind === 'view') {
      const viewStore = await resolveView({
        view: rawSource as ParsedViewSource,
        registry: parsed,
      });
      for (const quad of viewStore.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }
    const source = rawSource as ParsedGlobSource | ParsedEndpointSource;
    const effectiveMode: GraphMode =
      source.graphMode ?? options.graphMode ?? 'preserve';
    const overrideGraph = source.graph
      ? DataFactory.namedNode(source.graph)
      : undefined;

    if (source.kind === 'endpoint') {
      const sub = await loadEndpointToStore(source);
      const syntheticGraph =
        overrideGraph ?? DataFactory.namedNode(source.endpoint);
      const after = applyGraphMode(sub, effectiveMode, syntheticGraph);
      for (const quad of after.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }

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
    allFiles.push(...sub.files);
    Object.assign(allPrefixes, sub.prefixes);
  }

  return { store: merged, files: allFiles, prefixes: allPrefixes };
}

function applyGraphMode(
  source: Store,
  mode: GraphMode,
  syntheticGraph: ReturnType<typeof DataFactory.namedNode>,
): Store {
  if (mode === 'preserve') return source;
  const out = new Store();
  for (const quad of source.getQuads(null, null, null, null)) {
    let graph: Quad['graph'] = quad.graph;
    if (mode === 'flatten') {
      graph = DataFactory.defaultGraph();
    } else if (mode === 'forceAll') {
      graph = syntheticGraph;
    } else if (mode === 'fillDefault' && quad.graph.termType === 'DefaultGraph') {
      graph = syntheticGraph;
    }
    out.addQuad(
      DataFactory.quad(quad.subject, quad.predicate, quad.object, graph),
    );
  }
  return out;
}
