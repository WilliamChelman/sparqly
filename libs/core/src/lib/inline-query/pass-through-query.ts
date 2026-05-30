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

export interface InlineQueryLogMeta {
  source: string;
  logger?: SparqlyLogger;
}

export type PassThroughSource =
  | { kind: 'endpoint'; endpoint: ParsedEndpointSource }
  | { kind: 'disk-backed'; indexSource: RDF.Source; label: string };

export interface RunPassThroughQueryOptions {
  source: PassThroughSource;
  query: string;
  engine?: ComunicaQueryEngine;
  meta?: InlineQueryLogMeta;
}

export type RunPassThroughQueryError = EndpointFetchError | QueryExecutionError;

/**
 * Runs an inline query directly against an endpoint or a disk-backed glob index
 * (no in-heap materialization). Returns the projected `Store` (ADR-0024).
 */
export function runPassThroughQueryResult(
  options: RunPassThroughQueryOptions,
): ResultAsync<Store, RunPassThroughQueryError> {
  return ResultAsync.fromPromise(executePassThrough(options), (err) =>
    options.source.kind === 'endpoint'
      ? {
          kind: 'endpoint-fetch' as const,
          endpoint: options.source.endpoint.endpoint,
          message: describeEndpointError(err),
        }
      : {
          kind: 'query-execution' as const,
          query: options.query,
          message: err instanceof Error ? err.message : String(err),
        },
  );
}

async function executePassThrough(
  options: RunPassThroughQueryOptions,
): Promise<Store> {
  const engine = options.engine ?? new ComunicaQueryEngine();
  const out = new Store();
  const started = Date.now();
  const type = detectQueryType(options.query);
  try {
    const context =
      options.source.kind === 'endpoint'
        ? (buildEndpointContext(options.source.endpoint) as Parameters<
            ComunicaQueryEngine['query']
          >[1])
        : ({ sources: [options.source.indexSource] } as Parameters<
            ComunicaQueryEngine['query']
          >[1]);
    const result = await engine.query(options.query, context);
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
        `inline query produced unexpected result type: ${String(result.resultType)}`,
      );
    }
    if (options.meta) {
      emitQueryEvent(options.meta.logger, {
        source: options.meta.source,
        mode: 'pass-through',
        query: options.query,
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
        mode: 'pass-through',
        query: options.query,
        type,
        ms: Date.now() - started,
        err: new Error(`${prefix}: ${detail}`),
      });
    }
    throw err;
  }
}
