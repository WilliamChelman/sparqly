import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import { ResultAsync, okAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { emitQueryEvent, loadRdfResult } from '../engine';
import { detectQueryType } from '../canonical/immutability';
import {
  applyTransformPipeline,
  storageTier,
  unionDefaultGraphEnabled,
  type ParsedEmptySource,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from '../sources';
import type {
  EndpointFetchError,
  GlobLoadError,
  QueryExecutionError,
  InlineQueryValidationError,
  TransformParseError,
} from '../sources/errors';
import { resolveDiskBackedIndexHandleResult } from './disk-backed-index-handle';
import {
  runPassThroughQueryResult,
  type InlineQueryLogMeta,
} from './pass-through-query';

/** Any source kind an inline query can scope (every parsed source but a `reference` alias). */
export type InlineQueryUpstream = Exclude<ParsedSource, { kind: 'reference' }>;

export type ExecuteInlineQueryError =
  | InlineQueryValidationError
  | EndpointFetchError
  | QueryExecutionError
  | GlobLoadError
  | TransformParseError;

export interface ExecuteInlineQueryOptions {
  engine?: ComunicaQueryEngine;
  logger?: SparqlyLogger;
  /** Resolution root for disk-backed glob indexes; defaults to `process.cwd()`. */
  configDir?: string;
}

/**
 * Executes a validated inline query against a single upstream source and returns
 * the projected {@link Store}. Endpoints and disk-backed globs run pass-through
 * (no heap materialization); in-memory globs, files, and `empty` materialize and
 * run the query against the heap store (ADR-0051).
 */
export function executeInlineQueryResult(
  upstream: InlineQueryUpstream,
  query: string,
  options: ExecuteInlineQueryOptions = {},
): ResultAsync<Store, ExecuteInlineQueryError> {
  const meta: InlineQueryLogMeta = {
    source: upstreamLabel(upstream),
    logger: options.logger,
  };
  if (upstream.kind === 'endpoint') {
    return runPassThroughQueryResult({
      source: { kind: 'endpoint', endpoint: upstream },
      query,
      engine: options.engine,
      meta,
    });
  }
  if (upstream.kind === 'glob' && storageTier(upstream) === 'disk') {
    return runOverDiskBackedGlob(upstream, query, meta, options);
  }
  return loadUpstreamStore(upstream, options).andThen<Store, ExecuteInlineQueryError>(
    (store) =>
      runInMemoryQueryResult(
        store,
        query,
        meta,
        options.engine,
        unionDefaultGraphEnabled(upstream),
      ),
  );
}

function upstreamLabel(upstream: InlineQueryUpstream): string {
  if (upstream.kind === 'glob') return upstream.glob;
  if (upstream.kind === 'file') return upstream.path;
  if (upstream.kind === 'endpoint') return upstream.endpoint;
  return upstream.id ?? `(${upstream.kind})`;
}

function loadUpstreamStore(
  upstream: ParsedGlobSource | ParsedFileSource | ParsedEmptySource,
  options: ExecuteInlineQueryOptions,
): ResultAsync<Store, GlobLoadError> {
  if (upstream.kind === 'empty') {
    return okAsync(new Store());
  }
  const sources = upstream.kind === 'file' ? upstream.path : upstream.glob;
  return loadRdfResult({ sources, logger: options.logger }).map((sub) =>
    applyTransformPipeline(sub.store, upstream.transforms ?? [], {
      perFileRecords: sub.perFileRecords,
    }),
  );
}

function runOverDiskBackedGlob(
  upstream: ParsedGlobSource,
  query: string,
  meta: InlineQueryLogMeta,
  options: ExecuteInlineQueryOptions,
): ResultAsync<Store, ExecuteInlineQueryError> {
  const label = `@${upstream.id ?? upstream.glob}`;
  return resolveDiskBackedIndexHandleResult(upstream, {
    configDir: options.configDir ?? process.cwd(),
  }).andThen<Store, ExecuteInlineQueryError>((handle) => {
    const settled = runPassThroughQueryResult({
      source: { kind: 'disk-backed', indexSource: handle.source, label },
      query,
      engine: options.engine,
      meta,
    });
    // Release the LevelDB lock whether the query succeeds or fails.
    return ResultAsync.fromSafePromise(
      Promise.resolve(settled).then(async (r) => {
        await handle.close();
        return r;
      }),
    ).andThen((r) => r);
  });
}

function runInMemoryQueryResult(
  source: Store,
  query: string,
  meta: InlineQueryLogMeta,
  engine: ComunicaQueryEngine | undefined,
  unionDefaultGraph: boolean,
): ResultAsync<Store, QueryExecutionError> {
  return ResultAsync.fromPromise(
    runInMemoryQuery(source, query, engine, meta, unionDefaultGraph),
    (err) => ({
      kind: 'query-execution',
      query,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

async function runInMemoryQuery(
  source: Store,
  query: string,
  engine: ComunicaQueryEngine | undefined,
  meta: InlineQueryLogMeta,
  unionDefaultGraph: boolean,
): Promise<Store> {
  const e = engine ?? new ComunicaQueryEngine();
  const out = new Store();
  const started = Date.now();
  const type = detectQueryType(query);
  try {
    const result = await e.query(query, {
      sources: [source],
      ...(unionDefaultGraph ? { unionDefaultGraph: true } : {}),
    });
    if (result.resultType === 'bindings') {
      const bindings = await result.execute();
      for await (const b of bindings as AsyncIterable<{
        get(
          name: string,
        ): Quad['subject'] | Quad['predicate'] | Quad['object'] | undefined;
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
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'materialized',
      query,
      type,
      ms: Date.now() - started,
      size: { quads: out.size },
    });
    return out;
  } catch (err) {
    emitQueryEvent(meta.logger, {
      source: meta.source,
      mode: 'materialized',
      query,
      type,
      ms: Date.now() - started,
      err,
    });
    throw err;
  }
}
