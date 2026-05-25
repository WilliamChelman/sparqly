import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import type * as RDF from '@rdfjs/types';
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
import type {
  EndpointFetchError,
  QueryExecutionError,
} from '../sources/errors';

export interface ViewQueryLogMeta {
  source: string;
  logger?: SparqlyLogger;
}

export type PassThroughSource =
  | { kind: 'endpoint'; endpoint: ParsedEndpointSource }
  | { kind: 'disk-backed'; indexSource: RDF.Source; label: string };

export interface ResolveViewPassThroughOptions {
  source: PassThroughSource;
  viewQuery: string;
  engine?: ComunicaQueryEngine;
  meta?: ViewQueryLogMeta;
}

export type ResolveViewPassThroughError =
  | EndpointFetchError
  | QueryExecutionError;

export function resolveViewPassThroughResult(
  options: ResolveViewPassThroughOptions,
): ResultAsync<Store, ResolveViewPassThroughError> {
  return ResultAsync.fromPromise(executePassThrough(options), (err) =>
    options.source.kind === 'endpoint'
      ? {
          kind: 'endpoint-fetch' as const,
          endpoint: options.source.endpoint.endpoint,
          message: describeEndpointError(err),
        }
      : {
          kind: 'query-execution' as const,
          query: options.viewQuery,
          message: err instanceof Error ? err.message : String(err),
        },
  );
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
    const prefix =
      options.source.kind === 'endpoint'
        ? `endpoint ${options.source.endpoint.endpoint}`
        : `disk-backed glob ${options.source.label}`;
    throw new Error(`${prefix}: ${result.error.message}`);
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
    const context =
      options.source.kind === 'endpoint'
        ? (buildEndpointContext(options.source.endpoint) as Parameters<
            ComunicaQueryEngine['query']
          >[1])
        : ({ sources: [options.source.indexSource] } as Parameters<
            ComunicaQueryEngine['query']
          >[1]);
    const result = await engine.query(options.viewQuery, context);
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
      const prefix =
        options.source.kind === 'endpoint'
          ? `endpoint ${options.source.endpoint.endpoint}`
          : `disk-backed glob ${options.source.label}`;
      const detail =
        options.source.kind === 'endpoint'
          ? describeEndpointError(err)
          : err instanceof Error
            ? err.message
            : String(err);
      emitQueryEvent(options.meta.logger, {
        source: options.meta.source,
        mode: 'view',
        query: options.viewQuery,
        type,
        ms: Date.now() - started,
        err: new Error(`${prefix}: ${detail}`),
      });
    }
    throw err;
  }
}
