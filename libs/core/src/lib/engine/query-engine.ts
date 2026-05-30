import type * as RDF from '@rdfjs/types';
import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Parser, Writer } from 'n3';
import { ResultAsync } from 'neverthrow';
import { noopLogger, type SparqlyLogger } from 'common';
import { detectSelectShape } from '../diff';
import { reifyTripleShapedBindings } from './select-spo-reifier';
import {
  buildEndpointContext,
  describeEndpointError,
  type ComunicaEndpointContext,
} from './endpoint-http';
import {
  emitQueryEvent,
  type QueryResolutionMode,
  type QueryResultSize,
} from './query-log';
import {
  assertImmutable,
  detectQueryType,
  type QueryType,
} from '../canonical/immutability';
import type {
  EndpointFetchError,
  QueryExecutionError,
} from '../sources/errors';
import type { ParsedEndpointSource } from '../sources';

export const SUPPORTED_FORMATS = ['json', 'turtle', 'trig', 'nquads'] as const;

export type SparqlFormat = (typeof SUPPORTED_FORMATS)[number];

const FORMAT_TO_MIME: Record<SparqlFormat, string> = {
  json: 'application/sparql-results+json',
  turtle: 'text/turtle',
  trig: 'application/trig',
  nquads: 'application/n-quads',
};

export const MIME_TO_FORMAT: Readonly<Record<string, SparqlFormat>> =
  Object.fromEntries(
    (Object.entries(FORMAT_TO_MIME) as Array<[SparqlFormat, string]>).map(
      ([format, mime]) => [mime, format],
    ),
  );

const RDF_FORMATS: ReadonlySet<SparqlFormat> = new Set(['turtle', 'trig', 'nquads']);

export interface ExecuteOptions {
  format?: SparqlFormat;
  mutable?: boolean;
  /**
   * Cooperative cancellation (ADR-0050): when this aborts, the engine destroys
   * the stream it is consuming so the query collapses into a typed
   * {@link QueryExecutionError}. A query stuck in a synchronous stretch never
   * sees it — the worker pool's nuclear path reclaims that case.
   */
  signal?: AbortSignal;
}

function cancelledError(): Error {
  return new Error('query cancelled');
}

export interface ExecuteResult {
  body: string;
  format: SparqlFormat;
  contentType: string;
}

/**
 * The query surface the HTTP boundary depends on. {@link QueryEngine} satisfies
 * it directly (in-process), and ADR-0050's worker-backed executor satisfies it
 * by message-passing to a worker thread — so the controller stays thread-unaware
 * and no threading logic leaks into `libs/core`.
 */
export interface QueryExecutor {
  execute(query: string, options?: ExecuteOptions): Promise<ExecuteResult>;
  executeResult(
    query: string,
    options?: ExecuteOptions,
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError>;
}

// Materialized RDF source for Comunica's `sources: [...]` context — an
// RDF/JS source (in-memory `n3.Store` or a disk-backed quadstore index) or
// a thunk that resolves one lazily.
export type StoreSource = RDF.Source | (() => RDF.Source);

export type QueryEngineSource = StoreSource | ParsedEndpointSource;

export type { QueryResolutionMode };

// With no `logger`, the engine emits nothing on the query boundary.
export interface QueryEngineMeta {
  id: string;
  mode: QueryResolutionMode;
  logger?: SparqlyLogger;
}

// Materialized-store-only options; ignored on the endpoint pass-through path.
export interface QueryEngineOptions {
  /**
   * Runs SPARQL with Comunica's `unionDefaultGraph`: the default graph behaves
   * as the union of all graphs, so `WHERE { ?s ?p ?o }` reaches named-graph
   * quads while `GRAPH ?g` still addresses them individually.
   */
  unionDefaultGraph?: boolean;
}

export class QueryEngine implements QueryExecutor {
  private readonly engine = new ComunicaQueryEngine();
  private readonly resolveContext: () => Record<string, unknown>;
  private readonly endpointSource: ParsedEndpointSource | undefined;
  private readonly meta: QueryEngineMeta | undefined;
  private readonly logger: SparqlyLogger;

  constructor(
    source: QueryEngineSource,
    meta?: QueryEngineMeta,
    options?: QueryEngineOptions,
  ) {
    this.meta = meta;
    this.logger = meta?.logger ?? noopLogger;
    if (isParsedEndpointSource(source)) {
      this.endpointSource = source;
      const ctx = buildEndpointContext(source);
      this.resolveContext = (): Record<string, unknown> =>
        ctx as unknown as Record<string, unknown>;
    } else {
      this.endpointSource = undefined;
      const resolveStore: () => RDF.Source =
        typeof source === 'function' ? source : (): RDF.Source => source;
      const unionDefaultGraph = options?.unionDefaultGraph === true;
      this.resolveContext = (): Record<string, unknown> => ({
        sources: [resolveStore()],
        ...(unionDefaultGraph ? { unionDefaultGraph: true } : {}),
      });
    }
  }

  /**
   * Primary `Result`-typed execute. Throws collapse into either an
   * {@link EndpointFetchError} (endpoint path) or {@link QueryExecutionError}
   * (materialized path). The mutability guard and "can't happen" invariants
   * still throw.
   */
  executeResult(
    query: string,
    options: ExecuteOptions = {},
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
    return ResultAsync.fromPromise(
      this.execute(query, options),
      (err) => this.toExecuteError(query, err),
    );
  }

  async execute(query: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const queryType = detectQueryType(query);
    assertImmutable(queryType, { mutable: options.mutable });
    if (options.signal?.aborted) throw cancelledError();

    const started = Date.now();
    try {
      const result = await this.wrapEndpointErrors(() =>
        this.engine.query(
          query,
          this.resolveContext() as Parameters<ComunicaQueryEngine['query']>[1],
        ),
      );
      const resultType = result.resultType;

      const defaultFormat: SparqlFormat =
        resultType === 'quads' ? 'turtle' : 'json';
      const format = options.format ?? defaultFormat;

      if (RDF_FORMATS.has(format) && resultType === 'boolean') {
        throw new Error(
          `Format '${format}' is incompatible with ASK queries. Use 'json' or omit --format.`,
        );
      }
      if (format === 'json' && resultType === 'quads') {
        throw new Error(
          `Format 'json' is incompatible with CONSTRUCT/DESCRIBE queries. Use 'turtle', 'trig', 'nquads', or omit --format.`,
        );
      }

      const mediaType = FORMAT_TO_MIME[format];
      const body = await this.wrapEndpointErrors(async () => {
        if (RDF_FORMATS.has(format) && resultType === 'bindings') {
          return reifyBindingsToRdfString(
            result,
            query,
            format,
            mediaType,
            options.signal,
          );
        }
        const stringified = await this.engine.resultToString(result, mediaType);
        return streamToString(stringified.data, options.signal);
      });
      this.emitQueryEvent(query, queryType, Date.now() - started, {
        resultType,
        format,
        body,
      });
      return { body, format, contentType: mediaType };
    } catch (err) {
      this.emitQueryEvent(query, queryType, Date.now() - started, { err });
      throw err;
    }
  }

  private toExecuteError(
    query: string,
    err: unknown,
  ): QueryExecutionError | EndpointFetchError {
    const message = err instanceof Error ? err.message : String(err);
    if (this.endpointSource) {
      const prefix = `endpoint ${this.endpointSource.endpoint}: `;
      const trimmed = message.startsWith(prefix)
        ? message.slice(prefix.length)
        : message;
      return {
        kind: 'endpoint-fetch',
        endpoint: this.endpointSource.endpoint,
        message: trimmed,
      };
    }
    return { kind: 'query-execution', query, message };
  }

  private emitQueryEvent(
    query: string,
    type: QueryType,
    ms: number,
    outcome:
      | { resultType: string; format: SparqlFormat; body: string }
      | { err: unknown },
  ): void {
    if (this.logger === noopLogger) return;
    const isOk = 'body' in outcome;
    emitQueryEvent(this.logger, {
      source: this.meta?.id,
      mode: this.meta?.mode,
      query,
      type,
      ms,
      size: isOk ? resultSize(outcome.resultType, outcome.body, outcome.format) : undefined,
      bytes: isOk ? Buffer.byteLength(outcome.body) : undefined,
      err: isOk ? undefined : outcome.err,
    });
  }

  private async wrapEndpointErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (this.endpointSource) {
        throw new Error(
          `endpoint ${this.endpointSource.endpoint}: ${describeEndpointError(err)}`,
        );
      }
      throw err;
    }
  }
}

function isParsedEndpointSource(
  source: QueryEngineSource,
): source is ParsedEndpointSource {
  return (
    typeof source === 'object' &&
    source !== null &&
    'kind' in source &&
    (source as { kind: unknown }).kind === 'endpoint'
  );
}

function resultSize(
  resultType: string,
  body: string,
  format: SparqlFormat,
): QueryResultSize {
  if (format === 'turtle' || format === 'trig' || format === 'nquads') {
    const parserFormat =
      format === 'nquads' ? 'N-Quads' : format === 'trig' ? 'TriG' : 'Turtle';
    return { quads: new Parser({ format: parserFormat }).parse(body).length };
  }
  const parsed = JSON.parse(body) as {
    boolean?: boolean;
    results?: { bindings?: unknown[] };
  };
  if (resultType === 'boolean') return { boolean: parsed.boolean };
  return { rows: parsed.results?.bindings?.length ?? 0 };
}

async function reifyBindingsToRdfString(
  result: Awaited<ReturnType<ComunicaQueryEngine['query']>>,
  query: string,
  format: SparqlFormat,
  mediaType: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const { variables } = detectSelectShape(query);
  const rows = await collectBindingRows(result, variables, signal);
  const quads = reifyTripleShapedBindings({ variables, bindings: rows });
  if (quads === null) {
    const projection = variables.length === 0 ? '(none)' : `?${variables.join(' ?')}`;
    throw new Error(
      `Format '${format}' requires a triple-shaped SELECT projecting ?s ?p ?o (and optionally ?g). Got projection: ${projection}.`,
    );
  }
  return writeQuadsToString(quads, mediaType);
}

async function collectBindingRows(
  result: Awaited<ReturnType<ComunicaQueryEngine['query']>>,
  variables: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<Record<string, RDF.Term>[]> {
  if (result.resultType !== 'bindings') {
    throw new Error(
      `expected bindings result for reification, got ${result.resultType}`,
    );
  }
  const stream = (await result.execute()) as AsyncIterable<{
    get(name: string): RDF.Term | undefined;
  }> & { destroy(error?: Error): void };
  const detach = wireAbort(stream, signal);
  try {
    const rows: Record<string, RDF.Term>[] = [];
    for await (const b of stream) {
      const row: Record<string, RDF.Term> = {};
      for (const v of variables) {
        const term = b.get(v);
        if (term !== undefined) row[v] = term;
      }
      rows.push(row);
    }
    return rows;
  } finally {
    detach();
  }
}

async function writeQuadsToString(
  quads: ReadonlyArray<RDF.Quad>,
  mediaType: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const writer = new Writer({ format: mediaType });
    writer.addQuads(quads as RDF.Quad[]);
    writer.end((err: Error | null | undefined, output: string) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}

async function streamToString(
  stream: NodeJS.ReadableStream,
  signal?: AbortSignal,
): Promise<string> {
  const detach = wireAbort(
    stream as NodeJS.ReadableStream & { destroy(error?: Error): void },
    signal,
  );
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    detach();
  }
}

/**
 * Destroys `stream` when `signal` aborts so the `for await` consuming it throws
 * {@link cancelledError} (ADR-0050). Returns a detach fn for the caller's
 * `finally`, so a settled query leaves no listener on a long-lived signal.
 */
function wireAbort(
  stream: { destroy(error?: Error): void },
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) return () => undefined;
  if (signal.aborted) {
    stream.destroy(cancelledError());
    return () => undefined;
  }
  const onAbort = (): void => stream.destroy(cancelledError());
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export type { ComunicaEndpointContext };
