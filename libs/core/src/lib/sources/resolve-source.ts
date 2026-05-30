import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { SparqlyLogger } from 'common';
import type { GraphMode } from '../engine';
import type { ParsedEndpointSource, ParsedSource } from './source-spec';
import {
  formatSourceError,
  resolveSourceResult,
  type ResolveSourceResultOptions,
} from './resolve-source-result';
import type { SourceRecordSidecar } from './source-record-sidecar';

export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
      // Absent for view, empty, and endpoint resolutions. Keys are
      // graph-agnostic triple-pattern strings; re-key by canonical N-Quads at
      // diff time via the canonicalizer's blank-node label map.
      sourceRecords?: SourceRecordSidecar;
    }
  | {
      mode: 'disk-backed';
      source: RDF.Source;
      files: string[];
      indexDir: string;
      // Releases the embedded LevelDB lock; must be called once querying is
      // done.
      close(): Promise<void>;
    };

export interface ResolveSourceOptions {
  // Default `graphName` mode applied when a glob target has no `transforms`
  // declared. Sources that already declare `transforms` pass through unchanged.
  graphMode?: GraphMode;
  logger?: SparqlyLogger;
}

/** @deprecated Use `resolveSourceResult`. Throw-wrapping adapter. */
export async function resolveSource(
  target: ParsedSource,
  options: ResolveSourceOptions = {},
): Promise<QuerySources> {
  const result = await resolveSourceResult(
    target,
    options as ResolveSourceResultOptions,
  );
  if (result.isErr()) throw new Error(formatSourceError(result.error));
  return result.value;
}
