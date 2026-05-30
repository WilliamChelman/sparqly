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
  GitPinError,
  GlobLoadError,
  QueryExecutionError,
  TransformParseError,
  ViewReferenceError,
  ViewValidationError,
} from '../sources/errors';
import type { TabularRow } from '../diff';
import { validateInlineQueryResult } from './validate-query';

export interface InlineSelectBindingsInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /** Sibling source-specs to resolve a `view` upstream's `from:` chain. */
  registry?: ReadonlyArray<SourceSpecInput>;
  engine?: ComunicaQueryEngine;
  logger?: SparqlyLogger;
}

export interface InlineSelectBindingsResult {
  variables: string[];
  /** In source-iteration order; multiplicity preserved (no dedup). */
  rows: TabularRow[];
}

export type ResolveInlineSelectBindingsError =
  | ViewValidationError
  | ViewReferenceError
  | CacheIoError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError
  | TransformParseError
  | GitPinError;

function upstreamLabel(upstream: ParsedSource): string {
  if (upstream.kind === 'glob') return upstream.glob;
  if (upstream.kind === 'file') return upstream.path;
  if (upstream.kind === 'endpoint') return upstream.endpoint;
  return upstream.id ?? `(${upstream.kind})`;
}

export function resolveInlineSelectBindingsResult(
  input: InlineSelectBindingsInput,
): ResultAsync<InlineSelectBindingsResult, ResolveInlineSelectBindingsError> {
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
    InlineSelectBindingsResult,
    ResolveInlineSelectBindingsError
  >((query) =>
    validateInlineQueryResult(query, { mode: 'tabular-anon' })
      .map(() => query)
      .asyncAndThen<
        InlineSelectBindingsResult,
        ResolveInlineSelectBindingsError
      >((validQuery) =>
        executeSelectBindingsResult(upstream, validQuery, input),
      ),
  );
}

function executeSelectBindingsResult(
  upstream: Exclude<ParsedSource, { kind: 'reference' }>,
  query: string,
  input: InlineSelectBindingsInput,
): ResultAsync<InlineSelectBindingsResult, ResolveInlineSelectBindingsError> {
  const shape = detectSelectShape(query);
  const engine = input.engine ?? new ComunicaQueryEngine();
  const source = upstreamLabel(upstream);
  const type = detectQueryType(query);
  const started = Date.now();

  const eventOk = (bindings: InlineSelectBindingsResult): void => {
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
      InlineSelectBindingsResult,
      ResolveInlineSelectBindingsError
    >((sources) => {
    if (sources.mode === 'disk-backed') {
      // Release the LevelDB lock before returning so the next open of the index dir succeeds.
      void sources.close();
      const message =
        'inline query: disk-backed glob upstream (`storage: disk`) cannot be materialized for tabular diff';
      eventErr(new Error(message));
      return errAsync({ kind: 'glob-load', glob: [], message });
    }
    if (sources.mode !== 'materialized') {
      const message =
        'inline query: endpoint upstream cannot be materialized in tabular diff (use pass-through)';
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

/** @deprecated Use {@link resolveInlineSelectBindingsResult}. Throw-based adapter. */
export async function resolveInlineSelectBindings(
  input: InlineSelectBindingsInput,
): Promise<InlineSelectBindingsResult> {
  const result = await resolveInlineSelectBindingsResult(input);
  if (result.isErr()) {
    const err = result.error;
    if (err.kind === 'endpoint-fetch') {
      throw new Error(`endpoint ${err.endpoint}: ${err.message}`);
    }
    throw new Error(err.message);
  }
  return result.value;
}

// Variants the upstream resolver never actually produces here; collapse to
// view-validation so the caller's narrower union stays exhaustive.
function narrowUpstreamError(
  err: SourceError,
): ResolveInlineSelectBindingsError {
  if (err.kind === 'reference-target') {
    return {
      kind: 'view-validation',
      message:
        "inline query: `kind: 'reference'` entries cannot be resolved as a target",
    };
  }
  if (err.kind === 'raw-pass-through-target') {
    return { kind: 'view-validation', message: err.message };
  }
  return err;
}

async function collectBindings(
  result: Awaited<ReturnType<ComunicaQueryEngine['query']>>,
  variables: string[],
): Promise<InlineSelectBindingsResult> {
  if (result.resultType !== 'bindings') {
    throw new Error(
      `inline query: expected SELECT (bindings), got ${result.resultType}`,
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
