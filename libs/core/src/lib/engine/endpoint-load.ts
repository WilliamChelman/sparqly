import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { DataFactory, Store, type Quad } from 'n3';
import { ResultAsync } from 'neverthrow';
import {
  buildEndpointContext,
  describeEndpointError,
} from './endpoint-http';
import type { EndpointFetchError } from '../sources/errors';
import type { ParsedEndpointSource } from '../sources';

/**
 * Primary `Result`-typed endpoint loader. Wraps Comunica's pass-through SELECT
 * `?s ?p ?o` into a Store on success and collapses transport / non-bindings
 * failures into an {@link EndpointFetchError} variant carrying the endpoint
 * URL (ADR-0024).
 */
export function loadEndpointToStoreResult(
  source: ParsedEndpointSource,
  engine: ComunicaQueryEngine = new ComunicaQueryEngine(),
): ResultAsync<Store, EndpointFetchError> {
  return ResultAsync.fromPromise(executeEndpointLoad(source, engine), (err) => ({
    kind: 'endpoint-fetch' as const,
    endpoint: source.endpoint,
    message: describeEndpointError(err),
  }));
}

async function executeEndpointLoad(
  source: ParsedEndpointSource,
  engine: ComunicaQueryEngine,
): Promise<Store> {
  const out = new Store();
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
}

/**
 * @deprecated Use {@link loadEndpointToStoreResult} (ADR-0024). Retained as a
 * thin throw-based adapter for callers that have not migrated yet.
 */
export async function loadEndpointToStore(
  source: ParsedEndpointSource,
  engine: ComunicaQueryEngine = new ComunicaQueryEngine(),
): Promise<Store> {
  const result = await loadEndpointToStoreResult(source, engine);
  if (result.isErr()) {
    throw new Error(`endpoint ${source.endpoint}: ${result.error.message}`);
  }
  return result.value;
}
