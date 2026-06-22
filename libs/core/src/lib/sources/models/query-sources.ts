import type * as RDF from '@rdfjs/types';
import type { Store } from 'n3';
import type { ParsedEndpointSource } from '../source-spec';
import type { SourceRecordSidecar } from '../source-record-sidecar';

/**
 * The outcome of resolving a {@link ParsedSource} for querying. The three modes
 * mirror the storage tiers: an endpoint passes through untouched, a glob/file
 * materializes into an in-memory `Store`, and a disk-backed glob exposes a
 * queryable `RDF.Source` over an on-disk index that must be `close()`d. Returned
 * by `resolveSourceResult` (ADR-0024, ADR-0041).
 */
export type QuerySources =
  | { mode: 'pass-through'; endpoint: ParsedEndpointSource }
  | {
      mode: 'materialized';
      store: Store;
      files: string[];
      prefixes: Record<string, Record<string, string>>;
      // Absent for empty and endpoint resolutions. Keys are
      // graph-agnostic triple-pattern strings; re-key by canonical N-Quads at
      // diff time via the canonicalizer's blank-node label map.
      sourceRecords?: SourceRecordSidecar;
      // The commit SHA a pinned source (`gitRef`) resolved to, present only when
      // the materialized store came from a pin. The Query cache keys on it so a
      // moved floating ref recomputes; an unpinned working-tree load omits it and
      // the cache falls back to a stat-digest of `files` (ADR-0054, #415).
      resolvedSha?: string;
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
