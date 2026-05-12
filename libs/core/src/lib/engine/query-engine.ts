import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { Parser, type Store } from 'n3';
import {
  noopLogger,
  outcomeFields,
  truncateQueryText,
  type SparqlyLogFields,
  type SparqlyLogger,
} from 'common';
import {
  buildEndpointContext,
  describeEndpointError,
  type ComunicaEndpointContext,
} from './endpoint-http';
import {
  assertImmutable,
  detectQueryType,
  type QueryType,
} from '../canonical/immutability';
import type { ParsedEndpointSource } from '../sources';

export const SUPPORTED_FORMATS = ['json', 'turtle'] as const;

export type SparqlFormat = (typeof SUPPORTED_FORMATS)[number];

const FORMAT_TO_MIME: Record<SparqlFormat, string> = {
  json: 'application/sparql-results+json',
  turtle: 'text/turtle',
};

export interface ExecuteOptions {
  format?: SparqlFormat;
  mutable?: boolean;
}

export interface ExecuteResult {
  body: string;
  format: SparqlFormat;
  contentType: string;
}

export type StoreSource = Store | (() => Store);

export type QueryEngineSource = StoreSource | ParsedEndpointSource;

/** Resolution mode label for the SPARQL-execution log event (ADR-0020). */
export type QueryResolutionMode = 'materialized' | 'pass-through' | 'view';

/**
 * Optional context for boundary logging: the source `@id` (or endpoint URL),
 * how it was resolved, and the {@link SparqlyLogger} to emit the `query` event
 * on. Omitting it — or supplying no `logger` — makes the engine emit nothing.
 */
export interface QueryEngineMeta {
  id: string;
  mode: QueryResolutionMode;
  logger?: SparqlyLogger;
}

export class QueryEngine {
  private readonly engine = new ComunicaQueryEngine();
  private readonly resolveContext: () => Record<string, unknown>;
  private readonly endpointSource: ParsedEndpointSource | undefined;
  private readonly meta: QueryEngineMeta | undefined;
  private readonly logger: SparqlyLogger;

  constructor(source: QueryEngineSource, meta?: QueryEngineMeta) {
    this.meta = meta;
    this.logger = meta?.logger ?? noopLogger;
    if (isParsedEndpointSource(source)) {
      this.endpointSource = source;
      const ctx = buildEndpointContext(source);
      this.resolveContext = (): Record<string, unknown> =>
        ctx as unknown as Record<string, unknown>;
    } else {
      this.endpointSource = undefined;
      const resolveStore: () => Store =
        typeof source === 'function' ? source : (): Store => source;
      this.resolveContext = (): Record<string, unknown> => ({
        sources: [resolveStore()],
      });
    }
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

      if (format === 'turtle' && resultType !== 'quads') {
        const queryKind = resultType === 'boolean' ? 'ASK' : 'SELECT';
        throw new Error(
          `Format 'turtle' is incompatible with ${queryKind} queries. Use 'json' or omit --format.`,
        );
      }
      if (format === 'json' && resultType === 'quads') {
        throw new Error(
          `Format 'json' is incompatible with CONSTRUCT/DESCRIBE queries. Use 'turtle' or omit --format.`,
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

  private emitQueryEvent(
    query: string,
    type: QueryType,
    ms: number,
    outcome:
      | { resultType: string; format: SparqlFormat; body: string }
      | { err: unknown },
  ): void {
    if (this.logger === noopLogger) return;
    const fields: SparqlyLogFields = {
      ...(this.meta ? { source: this.meta.id, mode: this.meta.mode } : {}),
      type,
      ms,
    };
    if ('body' in outcome) {
      Object.assign(fields, resultSizeFields(outcome.resultType, outcome.body), {
        bytes: Buffer.byteLength(outcome.body),
      });
    }
    fields['query'] = truncateQueryText(query);
    if ('err' in outcome) Object.assign(fields, outcomeFields(outcome.err));
    this.logger.debug('query', fields);
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

function resultSizeFields(resultType: string, body: string): SparqlyLogFields {
  if (resultType === 'quads') return { quads: new Parser().parse(body).length };
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
