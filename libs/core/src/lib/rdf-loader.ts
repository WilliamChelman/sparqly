import { Store } from 'n3';
import { glob } from 'tinyglobby';
import { parseRdfFile, type RdfRecord } from './rdf-file-parser';

export const GRAPH_MODES = [
  'preserve',
  'fillDefault',
  'forceAll',
  'flatten',
] as const;

export type GraphMode = (typeof GRAPH_MODES)[number];

export interface LoadOptions {
  sources: string | string[];
}

export interface LoadResult {
  store: Store;
  files: string[];
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
  /**
   * Raw per-file records, in file order. Side-channel for the transform
   * pipeline — transforms like `graphName` need per-quad file provenance that
   * cannot be recovered from the merged Store alone. Omitted by callers that
   * synthesize a `LoadResult` without a backing file load (e.g. endpoint
   * loads in `loadSources`).
   */
  perFileRecords?: ReadonlyMap<string, ReadonlyArray<RdfRecord>>;
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

  const store = new Store();
  const prefixes: Record<string, Record<string, string>> = {};
  const perFileRecords = new Map<string, ReadonlyArray<RdfRecord>>();

  for (const file of files) {
    try {
      const result = await parseRdfFile(file);
      for (const { quad } of result.records) {
        store.addQuad(quad);
      }
      prefixes[file] = result.prefixes;
      perFileRecords.set(file, result.records);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${file}: ${message}`);
    }
  }

  return { store, files, prefixes, perFileRecords };
}
