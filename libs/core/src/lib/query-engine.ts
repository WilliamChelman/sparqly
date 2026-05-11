import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import type { Store } from 'n3';
import {
  buildEndpointContext,
  describeEndpointError,
  type ComunicaEndpointContext,
} from './endpoint-http';
import { assertImmutable, detectQueryType } from './canonical/immutability';
import type { ParsedEndpointSource } from './source-spec';

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

export class QueryEngine {
  private readonly engine = new ComunicaQueryEngine();
  private readonly resolveContext: () => Record<string, unknown>;
  private readonly endpointSource: ParsedEndpointSource | undefined;

  constructor(source: QueryEngineSource) {
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

    const result = await this.wrapEndpointErrors(() =>
      this.engine.query(
        query,
        this.resolveContext() as Parameters<ComunicaQueryEngine['query']>[1],
      ),
    );
    const resultType = result.resultType;

    const defaultFormat: SparqlFormat = resultType === 'quads' ? 'turtle' : 'json';
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
    return { body, format, contentType: mediaType };
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

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type { ComunicaEndpointContext };
