import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import type { Term } from 'n3';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  buildEndpointContext,
  describeEndpointError,
  emitQueryEvent,
} from '../engine';
import { detectQueryType } from '../canonical/immutability';
import { resolveSourceResult, type SourceError } from '../sources';
import { detectSelectShape } from '../diff';
import {
  parseSourceSpec,
  parseSourceSpecs,
  type ParsedSource,
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
import type { TabularRow } from '../diff';
import { validateViewQueryResult } from './view-query-validate';

export interface AnonymousSelectBindingsInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /**
   * Sibling source-specs needed to resolve a `view` upstream's `from:` chain.
   * Untargeted entries are never opened. Omit when the upstream is a bare
   * glob or empty source.
   */
  registry?: ReadonlyArray<SourceSpecInput>;
  /** Test seam: inject a Comunica engine. */
  engine?: ComunicaQueryEngine;
  /** When set, the SELECT execution emits a `query` debug event (`mode=view`). */
  logger?: SparqlyLogger;
}

export interface AnonymousSelectBindingsResult {
  /**
   * Projected variable names in projection order, omitting any leading `?`.
   * Matches `detectSelectShape`'s ordering — the right-hand side of the
   * tabular formatter's `vars` field.
   */
  variables: string[];
  /**
   * Bindings rows in source-iteration order. Multiplicity is preserved (no
   * dedup); callers that want bag semantics consume the array as-is.
   */
  rows: TabularRow[];
}

export type ResolveAnonymousSelectBindingsError =
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError;

function upstreamLabel(upstream: ParsedSource): string {
  if (upstream.kind === 'glob') return upstream.glob;
  if (upstream.kind === 'endpoint') return upstream.endpoint;
  return upstream.id ?? `(${upstream.kind})`;
}

/**
 * Primary `Result`-typed sibling of {@link resolveAnonymousViewResult} for
 * tabular diff. Validation failures (no/both `query`/`queryFile`, `@id`
 * upstream, non-SELECT, defensive endpoint-materialization mismatch) surface
 * as {@link ViewValidationError}; downstream resolution and execution errors
 * pass through with their structured variants (ADR-0024).
 */
export function resolveAnonymousSelectBindingsResult(
  input: AnonymousSelectBindingsInput,
): ResultAsync<AnonymousSelectBindingsResult, ResolveAnonymousSelectBindingsError> {
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message:
        '`query` and `queryFile` are mutually exclusive on an anonymous select-bindings resolver',
    });
  }
  if (!hasQuery && !hasQueryFile) {
    return errAsync({
      kind: 'view-validation',
      message:
        'an anonymous select-bindings resolver requires exactly one of `query` or `queryFile`',
    });
  }

  const upstream = parseSourceSpec(input.source);
  if (upstream.kind === 'reference') {
    return errAsync({
      kind: 'view-validation',
      message:
        'anonymous select-bindings: `@id` reference upstreams are not supported here',
    });
  }

  const queryLoader: ResultAsync<string, ViewValidationError> = hasQuery
    ? okAsync(input.query as string)
    : ResultAsync.fromPromise(
        readFile(resolvePath(process.cwd(), input.queryFile as string), 'utf8'),
        (err) => ({
          kind: 'view-validation' as const,
          message: err instanceof Error ? err.message : String(err),
        }),
      );

  return queryLoader.andThen<
    AnonymousSelectBindingsResult,
    ResolveAnonymousSelectBindingsError
  >((query) =>
    validateViewQueryResult(query, { mode: 'tabular-anon' })
      .map(() => query)
      .asyncAndThen<
        AnonymousSelectBindingsResult,
        ResolveAnonymousSelectBindingsError
      >((validQuery) =>
        executeSelectBindingsResult(upstream, validQuery, input),
      ),
  );
}

function executeSelectBindingsResult(
  upstream: Exclude<ParsedSource, { kind: 'reference' }>,
  query: string,
  input: AnonymousSelectBindingsInput,
): ResultAsync<
  AnonymousSelectBindingsResult,
  ResolveAnonymousSelectBindingsError
> {
  const shape = detectSelectShape(query);
  const engine = input.engine ?? new ComunicaQueryEngine();
  const source = upstreamLabel(upstream);
  const type = detectQueryType(query);
  const started = Date.now();

  const eventOk = (bindings: AnonymousSelectBindingsResult): void => {
    emitQueryEvent(input.logger, {
      source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      size: { rows: bindings.rows.length },
    });
  };
  const eventErr = (err: unknown): void => {
    emitQueryEvent(input.logger, {
      source,
      mode: 'view',
      query,
      type,
      ms: Date.now() - started,
      err,
    });
  };

  if (upstream.kind === 'endpoint') {
    return ResultAsync.fromPromise(
      (async () => {
        const result = await engine.query(
          query,
          buildEndpointContext(upstream) as Parameters<
            ComunicaQueryEngine['query']
          >[1],
        );
        return collectBindings(result, shape.variables);
      })(),
      (err): EndpointFetchError => {
        eventErr(err);
        return {
          kind: 'endpoint-fetch',
          endpoint: upstream.endpoint,
          message: describeEndpointError(err),
        };
      },
    ).map((bindings) => {
      eventOk(bindings);
      return bindings;
    });
  }

  const siblingRegistry = parseSourceSpecs(
    (input.registry ?? []) as SourceSpecInput[],
  );
  const fullRegistry: ParsedSource[] = [upstream, ...siblingRegistry];
  return resolveSourceResult(upstream, {
    registry: fullRegistry,
    logger: input.logger,
  })
    .mapErr(narrowUpstreamError)
    .andThen<
      AnonymousSelectBindingsResult,
      ResolveAnonymousSelectBindingsError
    >((sources) => {
    if (sources.mode !== 'materialized') {
      const message =
        'anonymous select-bindings: endpoint upstream cannot be materialized in tabular diff (use pass-through)';
      eventErr(new Error(message));
      return errAsync({ kind: 'view-validation', message });
    }
    return ResultAsync.fromPromise(
      (async () => {
        const result = await engine.query(query, {
          sources: [sources.store],
        });
        return collectBindings(result, shape.variables);
      })(),
      (err): QueryExecutionError => {
        eventErr(err);
        return {
          kind: 'query-execution',
          query,
          message: err instanceof Error ? err.message : String(err),
        };
      },
    ).map((bindings) => {
      eventOk(bindings);
      return bindings;
    });
  });
}

/**
 * @deprecated Use {@link resolveAnonymousSelectBindingsResult} (ADR-0024).
 * Retained as a thin throw-based adapter for callers that have not migrated
 * yet. Endpoint failures get the legacy `endpoint <url>: <message>` prefix to
 * preserve the historical message shape.
 */
export async function resolveAnonymousSelectBindings(
  input: AnonymousSelectBindingsInput,
): Promise<AnonymousSelectBindingsResult> {
  const result = await resolveAnonymousSelectBindingsResult(input);
  if (result.isErr()) {
    const err = result.error;
    if (err.kind === 'endpoint-fetch') {
      throw new Error(`endpoint ${err.endpoint}: ${err.message}`);
    }
    throw new Error(err.message);
  }
  return result.value;
}

/**
 * `resolveSourceResult` returns the full `SourceError` union, which includes
 * variants this leaf can't actually produce: `reference-target` is filtered
 * out at the start of {@link resolveAnonymousSelectBindingsResult}, and
 * `legacy-message` is the now-empty transitional bucket. Both are mapped to a
 * `view-validation` entry to keep the public error union narrow.
 */
function narrowUpstreamError(
  err: SourceError,
): ResolveAnonymousSelectBindingsError {
  if (err.kind === 'reference-target' || err.kind === 'legacy-message') {
    return {
      kind: 'view-validation',
      message:
        err.kind === 'legacy-message'
          ? err.message
          : "anonymous select-bindings: `kind: 'reference'` entries cannot be resolved as a target",
    };
  }
  return err;
}

async function collectBindings(
  result: Awaited<ReturnType<ComunicaQueryEngine['query']>>,
  variables: string[],
): Promise<AnonymousSelectBindingsResult> {
  if (result.resultType !== 'bindings') {
    throw new Error(
      `anonymous select-bindings: expected SELECT (bindings), got ${result.resultType}`,
    );
  }
  const bindings = await result.execute();
  const rows: TabularRow[] = [];
  for await (const b of bindings as AsyncIterable<{
    get(name: string): Term | undefined;
  }>) {
    const row: TabularRow = {};
    for (const v of variables) {
      row[v] = b.get(v);
    }
    rows.push(row);
  }
  return { variables, rows };
}
