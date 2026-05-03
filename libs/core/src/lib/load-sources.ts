import { DataFactory, Store } from 'n3';
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
    if (rawSource.kind === 'empty') {
      // An empty source contributes no quads on its own. It only matters as
      // the upstream of a view whose query composes data via SERVICE clauses.
      continue;
    }
    const source = rawSource as ParsedGlobSource | ParsedEndpointSource;

    if (source.kind === 'endpoint') {
      const sub = await loadEndpointToStore(source);
      for (const quad of sub.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }

    const effectiveMode: GraphMode =
      source.graphMode ?? options.graphMode ?? 'preserve';
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
    allFiles.push(...sub.files);
    Object.assign(allPrefixes, sub.prefixes);
  }

  return { store: merged, files: allFiles, prefixes: allPrefixes };
}
