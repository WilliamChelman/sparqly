import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import type { Store } from 'n3';

const SPARQL_RESULTS_JSON = 'application/sparql-results+json';

export class QueryEngine {
  private readonly engine = new ComunicaQueryEngine();

  constructor(private readonly store: Store) {}

  async select(query: string): Promise<string> {
    const result = await this.engine.query(query, {
      sources: [this.store],
    });
    const { data } = await this.engine.resultToString(
      result,
      SPARQL_RESULTS_JSON,
    );
    return await streamToString(data);
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
