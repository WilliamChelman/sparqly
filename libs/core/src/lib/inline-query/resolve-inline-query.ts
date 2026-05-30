import { Store } from 'n3';
import { ResultAsync, errAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  parseSourceSpec,
  type ParsedSource,
  type ParsedViewSource,
  type SourceSpecInput,
} from '../sources';
import type {
  CacheIoError,
  EndpointFetchError,
  GitPinError,
  GlobLoadError,
  QueryExecutionError,
  TransformParseError,
  ViewReferenceError,
  ViewValidationError,
} from '../sources/errors';
import { resolveViewResult } from '../views/view-resolver';

export interface InlineQueryInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /** Forwarded to view resolution so the SPARQL run emits a `query` event. */
  logger?: SparqlyLogger;
}

export type ResolveInlineQueryError =
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError
  | TransformParseError
  | GitPinError;

const SYNTHETIC_UPSTREAM_ID = '__sparqly_inline_upstream__';
const SYNTHETIC_VIEW_ID = '__sparqly_inline_query__';

function syntheticViewLabel(upstream: ParsedSource): string {
  const label =
    upstream.kind === 'glob'
      ? upstream.glob
      : upstream.kind === 'file'
        ? upstream.path
        : upstream.kind === 'endpoint'
          ? upstream.endpoint
          : (upstream.id ?? SYNTHETIC_VIEW_ID);
  // Keep the synthetic view id distinct from its upstream's so cycle
  // detection on the `from:` chain never false-positives.
  return label === (upstream.id ?? SYNTHETIC_UPSTREAM_ID)
    ? SYNTHETIC_VIEW_ID
    : label;
}

/**
 * Primary `Result`-typed inline-query resolver. Surface failures (no/both
 * `query`/`queryFile`, `@id` reference upstream) become {@link ViewValidationError}
 * variants; downstream view-resolution failures pass through unchanged
 * (ADR-0024).
 */
export function resolveInlineQueryResult(
  input: InlineQueryInput,
): ResultAsync<Store, ResolveInlineQueryError> {
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message:
        '`query` and `queryFile` are mutually exclusive on an inline query',
    });
  }
  if (!hasQuery && !hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message: 'an inline query requires exactly one of `query` or `queryFile`',
    });
  }

  const upstream = parseSourceSpec(input.source);
  if (upstream.kind === 'reference') {
    return errAsync({
      kind: 'view-validation',
      message: 'inline query: `@id` reference upstreams are not supported here',
    });
  }
  const upstreamId = upstream.id ?? SYNTHETIC_UPSTREAM_ID;
  const upstreamWithId: ParsedSource = { ...upstream, id: upstreamId };

  const view: ParsedViewSource = {
    kind: 'view',
    id: syntheticViewLabel(upstream),
    from: upstreamId,
    ...(hasQuery ? { query: input.query } : {}),
    ...(hasQueryFile ? { queryFile: input.queryFile } : {}),
  };

  return resolveViewResult({
    view,
    registry: [upstreamWithId, view],
    logger: input.logger,
  });
}

/**
 * @deprecated Use {@link resolveInlineQueryResult} (ADR-0024). Retained as a
 * thin throw-based adapter for callers that have not migrated yet.
 */
export async function resolveInlineQuery(
  input: InlineQueryInput,
): Promise<Store> {
  const result = await resolveInlineQueryResult(input);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}
