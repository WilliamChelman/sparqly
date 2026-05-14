import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import { ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import {
  buildEndpointContext,
  describeEndpointError,
  emitQueryEvent,
} from '../engine';
import { detectQueryType } from '../canonical/immutability';
import type { ParsedEndpointSource } from '../sources';
import type { EndpointFetchError } from '../sources/errors';

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

/**
 * Primary `Result`-typed pass-through resolver. Wraps the bindings/quads
 * streamed back from the endpoint into a Store on success and collapses any
 * transport / non-bindings failure into an {@link EndpointFetchError} carrying
 * the endpoint URL (ADR-0024).
 */
export function resolveViewPassThroughResult(
  options: ResolveViewPassThroughOptions,
): ResultAsync<Store, EndpointFetchError> {
  return ResultAsync.fromPromise(executePassThrough(options), (err) => ({
    kind: 'endpoint-fetch' as const,
    endpoint: options.endpoint.endpoint,
    message: describeEndpointError(err),
  }));
}

/**
 * @deprecated Use {@link resolveViewPassThroughResult} (ADR-0024). Retained as
 * a thin throw-based adapter for callers that have not migrated yet.
 */
export async function resolveViewPassThrough(
  options: ResolveViewPassThroughOptions,
): Promise<Store> {
  const result = await resolveViewPassThroughResult(options);
  if (result.isErr()) {
    throw new Error(
      `endpoint ${options.endpoint.endpoint}: ${result.error.message}`,
    );
  }
  return result.value;
}

async function executePassThrough(
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
    if (options.meta) {
      emitQueryEvent(options.meta.logger, {
        source: options.meta.source,
        mode: 'view',
        query: options.viewQuery,
        type,
        ms: Date.now() - started,
        err: new Error(
          `endpoint ${options.endpoint.endpoint}: ${describeEndpointError(err)}`,
        ),
      });
    }
    throw err;
  }
}
