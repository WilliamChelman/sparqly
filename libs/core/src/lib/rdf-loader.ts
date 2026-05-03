import { DataFactory, Store, type DefaultGraph, type NamedNode, type Quad } from 'n3';
import { glob } from 'tinyglobby';
import { parseRdfFile } from './rdf-file-parser';

export const GRAPH_MODES = [
  'preserve',
  'fillDefault',
  'forceAll',
  'flatten',
] as const;

export type GraphMode = (typeof GRAPH_MODES)[number];

export interface LoadOptions {
  sources: string | string[];
  graphMode?: GraphMode;
}

export interface LoadResult {
  store: Store;
  files: string[];
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
}

export async function loadRdf(options: LoadOptions): Promise<LoadResult> {
  const files = await glob(options.sources, { absolute: true });

  if (files.length === 0) {
    throw new Error(
      `No files matched sources: ${
        Array.isArray(options.sources)
          ? options.sources.join(', ')
          : options.sources
      }`,
    );
  }

  const mode: GraphMode = options.graphMode ?? 'preserve';
  const store = new Store();
  const prefixes: Record<string, Record<string, string>> = {};

  for (const file of files) {
    try {
      const result = await parseRdfFile(file);
      const fileGraph = DataFactory.namedNode(`file://${file}`);
      for (const { quad } of result.records) {
        const target = targetGraph(quad, mode, fileGraph);
        const out = target
          ? DataFactory.quad(quad.subject, quad.predicate, quad.object, target)
          : quad;
        store.addQuad(out);
      }
      prefixes[file] = result.prefixes;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${file}: ${message}`);
    }
  }

  return { store, files, prefixes };
}

function targetGraph(
  quad: Quad,
  mode: GraphMode,
  fileGraph: NamedNode,
): NamedNode | DefaultGraph | undefined {
  if (mode === 'flatten') return DataFactory.defaultGraph();
  if (mode === 'forceAll') return fileGraph;
  if (mode === 'fillDefault' && quad.graph.termType === 'DefaultGraph') {
    return fileGraph;
  }
  return undefined;
}
