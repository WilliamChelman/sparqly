/**
 * Tagged-union error type owned by the `sources` feature folder. Adding a
 * variant is one edit here plus one new case in `formatSourceError`. See
 * ADR-0024 for the surrounding convention.
 *
 * `legacy-message` is a transitional bucket holding messages thrown by
 * downstream leaves that have not yet been converted to `Result`. It will
 * shrink as those leaves are converted in subsequent slices and be deleted
 * entirely once the migration finishes (#243).
 */
export type SourceError =
  | ReferenceTargetError
  | GlobLoadError
  | QueryExecutionError
  | EndpointFetchError
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | LegacySourceError;

export interface ReferenceTargetError {
  kind: 'reference-target';
}

/**
 * Failure loading one or more files matched by a glob source. Carries the
 * glob pattern(s) always, the offending file path when the failure was
 * file-specific (parse error, unsupported extension), and the wrapped
 * underlying message.
 */
export interface GlobLoadError {
  kind: 'glob-load';
  glob: ReadonlyArray<string>;
  file?: string;
  message: string;
}

/**
 * Failure executing a SPARQL query against a materialized store. The query
 * text is carried for log/UI surfaces; the wrapped message is the underlying
 * Comunica / N3 detail.
 */
export interface QueryExecutionError {
  kind: 'query-execution';
  query: string;
  message: string;
}

/**
 * Failure fetching from a remote SPARQL endpoint — network error, non-2xx
 * response, malformed body, etc. The endpoint URL is always present.
 */
export interface EndpointFetchError {
  kind: 'endpoint-fetch';
  endpoint: string;
  message: string;
}

/**
 * Failure validating a view query — wrong query type (UPDATE/ASK/DESCRIBE),
 * SELECT projection mismatch, missing `query`/`queryFile`, or a syntactically
 * invalid query body. The view id is carried when known; anonymous-view
 * call sites that have no id may omit it.
 */
export interface ViewValidationError {
  kind: 'view-validation';
  viewId?: string;
  message: string;
}

/**
 * Failure resolving a view's `from:` reference — the ref doesn't exist in the
 * registry, the chain has a cycle, or the ref points at a `reference` entry
 * (an alias, not data). The view id and the offending ref are always present.
 */
export interface ViewReferenceError {
  kind: 'view-reference';
  viewId: string;
  ref: string;
  reason: 'unknown' | 'cycle' | 'reference-upstream';
  message: string;
}

/**
 * Failure reading, writing, parsing, or evicting a view cache entry. The
 * absolute cache path is always present.
 */
export interface CacheIoError {
  kind: 'cache-io';
  cachePath: string;
  message: string;
}

export interface LegacySourceError {
  kind: 'legacy-message';
  message: string;
}

export function formatSourceError(error: SourceError): string {
  switch (error.kind) {
    case 'reference-target':
      return "resolveSource: `kind: 'reference'` entries are aliases, not data, and cannot be resolved as a target";
    case 'glob-load':
      if (error.file !== undefined) {
        return `Failed to parse ${error.file}: ${error.message}`;
      }
      return error.message;
    case 'query-execution':
      return `query execution failed: ${error.message}`;
    case 'endpoint-fetch':
      return `endpoint ${error.endpoint}: ${error.message}`;
    case 'view-validation':
      return error.viewId !== undefined
        ? `view "${error.viewId}": ${error.message}`
        : error.message;
    case 'view-reference':
      return `view "${error.viewId}": ${error.message}`;
    case 'cache-io':
      return `cache ${error.cachePath}: ${error.message}`;
    case 'legacy-message':
      return error.message;
  }
}
