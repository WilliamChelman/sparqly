import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Store } from 'n3';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { parseSourceSpec, type SourceSpecInput } from '../sources';
import type { ViewValidationError } from '../sources/errors';
import {
  executeInlineQueryResult,
  type ExecuteInlineQueryError,
} from './execute-inline-query';
import { validateInlineQueryResult } from './validate-query';

export interface InlineQueryInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /** Forwarded to query execution so the SPARQL run emits a `query` event. */
  logger?: SparqlyLogger;
}

export type ResolveInlineQueryError = ExecuteInlineQueryError;

/**
 * Primary `Result`-typed inline-query resolver. Parses the upstream source,
 * loads and validates the query, then runs it against the upstream and returns
 * the scoped {@link Store}. Surface failures (no/both `query`/`queryFile`, `@id`
 * reference upstream) become {@link ViewValidationError} variants (ADR-0024,
 * ADR-0051).
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

  return loadQueryText(input).andThen<Store, ResolveInlineQueryError>((query) =>
    validateInlineQueryResult(query)
      .map(() => query)
      .asyncAndThen<Store, ResolveInlineQueryError>((validQuery) =>
        executeInlineQueryResult(upstream, validQuery, {
          logger: input.logger,
        }),
      ),
  );
}

function loadQueryText(
  input: InlineQueryInput,
): ResultAsync<string, ViewValidationError> {
  if (input.query !== undefined) return okAsync(input.query);
  const path = resolvePath(process.cwd(), input.queryFile as string);
  return ResultAsync.fromPromise(readFile(path, 'utf8'), (err) => ({
    kind: 'view-validation' as const,
    message: err instanceof Error ? err.message : String(err),
  }));
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
