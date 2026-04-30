import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import type { Store } from 'n3';
import { assertImmutable, detectQueryType } from './immutability';

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

export class QueryEngine {
  private readonly engine = new ComunicaQueryEngine();
  private readonly resolveStore: () => Store;

  constructor(source: StoreSource) {
    this.resolveStore =
      typeof source === 'function' ? source : (): Store => source;
  }

  async execute(query: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const queryType = detectQueryType(query);
    assertImmutable(queryType, { mutable: options.mutable });

    const result = await this.engine.query(query, {
      sources: [this.resolveStore()],
    });
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
    const { data } = await this.engine.resultToString(result, mediaType);
    const body = await streamToString(data);
    return { body, format, contentType: mediaType };
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
