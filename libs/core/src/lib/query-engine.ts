import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import type { Store } from 'n3';

export type SparqlFormat = 'json' | 'turtle';

const FORMAT_TO_MIME: Record<SparqlFormat, string> = {
  json: 'application/sparql-results+json',
  turtle: 'text/turtle',
};

const SUPPORTED_FORMATS: ReadonlyArray<SparqlFormat> = ['json', 'turtle'];

export interface ExecuteOptions {
  format?: SparqlFormat;
}

export interface ExecuteResult {
  body: string;
  format: SparqlFormat;
  contentType: string;
}

export function isSparqlFormat(value: string): value is SparqlFormat {
  return (SUPPORTED_FORMATS as ReadonlyArray<string>).includes(value);
}

export class QueryEngine {
  private readonly engine = new ComunicaQueryEngine();

  constructor(private readonly store: Store) {}

  async execute(query: string, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const result = await this.engine.query(query, { sources: [this.store] });
    const resultType = result.resultType;

    if (resultType === 'void') {
      throw new Error(
        'Mutating queries are disabled. Pass --mutable or --immutable=false to allow.',
      );
    }

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
