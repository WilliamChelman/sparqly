import type * as RDF from '@rdfjs/types';
import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Parser } from 'n3';
import { ResultAsync } from 'neverthrow';
import { noopLogger, type SparqlyLogger } from 'common';
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
}

export interface ExecuteResult {
  body: string;
  format: SparqlFormat;
  contentType: string;
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

export class QueryEngine {
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

      if (RDF_FORMATS.has(format) && resultType !== 'quads') {
        const queryKind = resultType === 'boolean' ? 'ASK' : 'SELECT';
        throw new Error(
          `Format '${format}' is incompatible with ${queryKind} queries. Use 'json' or omit --format.`,
        );
      }
      if (format === 'json' && resultType === 'quads') {
        throw new Error(
          `Format 'json' is incompatible with CONSTRUCT/DESCRIBE queries. Use 'turtle', 'trig', 'nquads', or omit --format.`,
        );
      }

      const mediaType = FORMAT_TO_MIME[format];
      const body = await this.wrapEndpointErrors(async () => {
        const stringified = await this.engine.resultToString(result, mediaType);
        return streamToString(stringified.data);
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
  if (resultType === 'quads') {
    const parserFormat = format === 'nquads' ? 'N-Quads' : format === 'trig' ? 'TriG' : 'Turtle';
    return { quads: new Parser({ format: parserFormat }).parse(body).length };
  }
  const parsed = JSON.parse(body) as {
    boolean?: boolean;
    results?: { bindings?: unknown[] };
  };
  if (resultType === 'boolean') return { boolean: parsed.boolean };
  return { rows: parsed.results?.bindings?.length ?? 0 };
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type { ComunicaEndpointContext };
