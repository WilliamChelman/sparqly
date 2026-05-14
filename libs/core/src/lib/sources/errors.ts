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
    case 'legacy-message':
      return error.message;
  }
}
