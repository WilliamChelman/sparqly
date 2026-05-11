import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import {
  buildEndpointContext,
  describeEndpointError,
} from './endpoint-http';
import type { ParsedEndpointSource } from '../source-spec';

export async function loadEndpointToStore(
  source: ParsedEndpointSource,
  engine: ComunicaQueryEngine = new ComunicaQueryEngine(),
): Promise<Store> {
  const out = new Store();
  try {
    const result = await engine.query(
      'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      buildEndpointContext(source) as Parameters<
        ComunicaQueryEngine['query']
      >[1],
    );
    if (result.resultType !== 'bindings') {
      throw new Error(
        `unexpected result type from endpoint: ${String(result.resultType)}`,
      );
    }
    const bindings = await result.execute();
    for await (const b of bindings as AsyncIterable<{
      get(name: string): Quad['subject'] | undefined;
    }>) {
      const s = b.get('s');
      const p = b.get('p');
      const o = b.get('o');
      if (!s || !p || !o) continue;
      out.addQuad(
        DataFactory.quad(
          s as Quad['subject'],
          p as Quad['predicate'],
          o as Quad['object'],
        ),
      );
    }
    return out;
  } catch (err) {
    throw new Error(
      `endpoint ${source.endpoint}: ${describeEndpointError(err)}`,
    );
  }
}
