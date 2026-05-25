/** Tagged-union error type for source resolution; Surface A runtime failures (see ADR-0024). */
export type SourceError =
  | ReferenceTargetError
  | GlobLoadError
  | QueryExecutionError
  | EndpointFetchError
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | TransformParseError
  | GitPinError
  | RawPassThroughTargetError;

export interface ReferenceTargetError {
  kind: 'reference-target';
}

/** Failure loading files matched by a glob source. */
export interface GlobLoadError {
  kind: 'glob-load';
  glob: ReadonlyArray<string>;
  file?: string;
  message: string;
}

/** Failure executing a SPARQL query against a materialized store. */
export interface QueryExecutionError {
  kind: 'query-execution';
  query: string;
  message: string;
}

/** Failure fetching from a remote SPARQL endpoint. */
export interface EndpointFetchError {
  kind: 'endpoint-fetch';
  endpoint: string;
  message: string;
}

/** Failure validating a view query. */
export interface ViewValidationError {
  kind: 'view-validation';
  viewId?: string;
  message: string;
}

/** Failure resolving a view's `from:` reference (unknown, cycle, or reference upstream). */
export interface ViewReferenceError {
  kind: 'view-reference';
  viewId: string;
  ref: string;
  reason: 'unknown' | 'cycle' | 'reference-upstream';
  message: string;
}

/** Failure reading, writing, parsing, or evicting a view cache entry. */
export interface CacheIoError {
  kind: 'cache-io';
  cachePath: string;
  message: string;
}

/** Failure parsing a transform spec at runtime resolution. */
export interface TransformParseError {
  kind: 'transform-parse';
  transformKey: string;
  message: string;
}

/** Failure resolving a `gitRef:` declaration for a glob source (see ADR-0029). */
export interface GitPinError {
  kind: 'git-pin';
  reason:
    | 'no-repo-found'
    | 'gitroot-not-a-repo'
    | 'unresolvable-ref'
    | 'pinned-file-missing';
  message: string;
}

export interface RawPassThroughTargetError {
  kind: 'raw-pass-through-target';
  source:
    | { kind: 'endpoint'; url: string }
    | { kind: 'disk-backed-glob'; label: string };
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
    case 'transform-parse':
      return `\`${error.transformKey}\`: ${error.message}`;
    case 'git-pin':
      return error.message;
    case 'raw-pass-through-target':
      return error.message;
  }
}

export function formatRawPassThroughRejection(
  source: RawPassThroughTargetError['source'],
  options: { side?: 'left' | 'right' } = {},
): string {
  const named =
    source.kind === 'endpoint'
      ? `endpoint ${source.url}`
      : `disk-backed glob ${source.label}`;
  const where =
    options.side === undefined ? '' : ` on the ${options.side} side`;
  return (
    `${named} cannot be hashed or diffed directly${where}: ` +
    `the canonicalization step has no scoping query and would materialise the whole upstream. ` +
    'Wrap it in a `view` source kind, pass `--query`/`--query-file` to scope it inline, ' +
    'or pipe `sparqly query --format=turtle` into the command.'
  );
}
