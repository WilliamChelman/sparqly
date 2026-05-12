import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import type { SparqlyLogger } from 'common';
import {
  buildEndpointContext,
  describeEndpointError,
  emitQueryEvent,
} from '../engine';
import { detectQueryType } from '../canonical/immutability';
import type { ParsedEndpointSource } from '../sources';

/** Identifies a view's SPARQL execution for the `query` log event (ADR-0020). */
export interface ViewQueryLogMeta {
  /** Source `@id` recorded on the `query` event (the view's id). */
  source: string;
  logger?: SparqlyLogger;
}

export interface ResolveViewPassThroughOptions {
  endpoint: ParsedEndpointSource;
  viewQuery: string;
  engine?: ComunicaQueryEngine;
  meta?: ViewQueryLogMeta;
}

export async function resolveViewPassThrough(
  options: ResolveViewPassThroughOptions,
): Promise<Store> {
  const engine = options.engine ?? new ComunicaQueryEngine();
  const out = new Store();
  const started = Date.now();
  const type = detectQueryType(options.viewQuery);
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
    } else if (result.resultType === 'quads') {
      const quads = await result.execute();
      for await (const q of quads as AsyncIterable<Quad>) {
        out.addQuad(q);
      }
    } else {
      throw new Error(
        `view query produced unexpected result type: ${String(result.resultType)}`,
      );
    }
    if (options.meta) {
      emitQueryEvent(options.meta.logger, {
        source: options.meta.source,
        mode: 'view',
        query: options.viewQuery,
        type,
        ms: Date.now() - started,
        size: { quads: out.size },
      });
    }
    return out;
  } catch (err) {
    const wrapped = new Error(
      `endpoint ${options.endpoint.endpoint}: ${describeEndpointError(err)}`,
    );
    if (options.meta) {
      emitQueryEvent(options.meta.logger, {
        source: options.meta.source,
        mode: 'view',
        query: options.viewQuery,
        type,
        ms: Date.now() - started,
        err: wrapped,
      });
    }
    throw wrapped;
  }
}
