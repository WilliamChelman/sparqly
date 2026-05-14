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
  GlobLoadError,
  QueryExecutionError,
  ViewReferenceError,
  ViewValidationError,
} from '../sources/errors';
import { resolveViewResult } from './view-resolver';

export interface AnonymousViewInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /** Forwarded to view resolution so the SPARQL run emits a `query` event. */
  logger?: SparqlyLogger;
}

export type ResolveAnonymousViewError =
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError;

const ANON_UPSTREAM_ID = '__sparqly_anon_upstream__';
const ANON_VIEW_ID = '__sparqly_anon_view__';

function anonViewLabel(upstream: ParsedSource): string {
  const label =
    upstream.kind === 'glob'
      ? upstream.glob
      : upstream.kind === 'endpoint'
        ? upstream.endpoint
        : (upstream.id ?? ANON_VIEW_ID);
  // Keep the synthetic view id distinct from its upstream's so cycle
  // detection on the `from:` chain never false-positives.
  return label === (upstream.id ?? ANON_UPSTREAM_ID) ? ANON_VIEW_ID : label;
}

/**
 * Primary `Result`-typed anonymous-view resolver. Surface failures (no/both
 * `query`/`queryFile`, `@id` reference upstream) become {@link ViewValidationError}
 * variants; downstream view-resolution failures pass through unchanged
 * (ADR-0024).
 */
export function resolveAnonymousViewResult(
  input: AnonymousViewInput,
): ResultAsync<Store, ResolveAnonymousViewError> {
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message:
        '`query` and `queryFile` are mutually exclusive on an anonymous view',
    });
  }
  if (!hasQuery && !hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message: 'an anonymous view requires exactly one of `query` or `queryFile`',
    });
  }

  const upstream = parseSourceSpec(input.source);
  if (upstream.kind === 'reference') {
    return errAsync({
      kind: 'view-validation',
      message: 'anonymous view: `@id` reference upstreams are not supported here',
    });
  }
  const upstreamId = upstream.id ?? ANON_UPSTREAM_ID;
  const upstreamWithId: ParsedSource = { ...upstream, id: upstreamId };

  const view: ParsedViewSource = {
    kind: 'view',
    id: anonViewLabel(upstream),
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
 * @deprecated Use {@link resolveAnonymousViewResult} (ADR-0024). Retained as a
 * thin throw-based adapter for callers that have not migrated yet.
 */
export async function resolveAnonymousView(
  input: AnonymousViewInput,
): Promise<Store> {
  const result = await resolveAnonymousViewResult(input);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}

