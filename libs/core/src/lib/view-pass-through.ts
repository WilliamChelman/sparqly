import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import {
  buildEndpointContext,
  describeEndpointError,
} from './endpoint-http';
import type { ParsedEndpointSource } from './source-spec';

export interface ResolveViewPassThroughOptions {
  endpoint: ParsedEndpointSource;
  viewQuery: string;
  engine?: ComunicaQueryEngine;
}

export async function resolveViewPassThrough(
  options: ResolveViewPassThroughOptions,
): Promise<Store> {
  const engine = options.engine ?? new ComunicaQueryEngine();
  const out = new Store();
  try {
    const result = await engine.query(
      options.viewQuery,
      buildEndpointContext(options.endpoint) as Parameters<
        ComunicaQueryEngine['query']
      >[1],
    );
    if (result.resultType === 'bindings') {
      const bindings = await result.execute();
      for await (const b of bindings as AsyncIterable<{
        get(name: string):
          | Quad['subject']
          | Quad['predicate']
          | Quad['object']
          | undefined;
      }>) {
        const s = b.get('s');
        const p = b.get('p');
        const o = b.get('o');
        const g = b.get('g');
        if (!s || !p || !o) continue;
        const graph = g ? (g as Quad['graph']) : DataFactory.defaultGraph();
        out.addQuad(
          DataFactory.quad(
            s as Quad['subject'],
            p as Quad['predicate'],
            o as Quad['object'],
            graph,
          ),
        );
      }
      return out;
    }
    if (result.resultType === 'quads') {
      const quads = await result.execute();
      for await (const q of quads as AsyncIterable<Quad>) {
        out.addQuad(q);
      }
      return out;
    }
    throw new Error(
      `view query produced unexpected result type: ${String(result.resultType)}`,
    );
  } catch (err) {
    throw new Error(
      `endpoint ${options.endpoint.endpoint}: ${describeEndpointError(err)}`,
    );
  }
}
