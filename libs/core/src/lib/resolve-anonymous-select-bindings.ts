import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import type { Term } from 'n3';
import {
  buildEndpointContext,
  describeEndpointError,
} from './engine';
import { resolveSource } from './resolve-source';
import { detectSelectShape } from './select-shape-detector';
import {
  parseSourceSpec,
  parseSourceSpecs,
  type ParsedEndpointSource,
  type ParsedSource,
  type SourceSpecInput,
} from './source-spec';
import type { TabularRow } from './tabular-row-key';
import { validateViewQuery } from './view-query-validate';

export interface AnonymousSelectBindingsInput {
  source: SourceSpecInput;
  query?: string;
  queryFile?: string;
  /**
   * Sibling source-specs needed to resolve a `view` upstream's `from:` chain.
   * Untargeted entries are never opened. Omit when the upstream is a bare
   * glob or empty source.
   */
  registry?: ReadonlyArray<SourceSpecInput>;
  /** Test seam: inject a Comunica engine. */
  engine?: ComunicaQueryEngine;
}

export interface AnonymousSelectBindingsResult {
  /**
   * Projected variable names in projection order, omitting any leading `?`.
   * Matches `detectSelectShape`'s ordering — the right-hand side of the
   * tabular formatter's `vars` field.
   */
  variables: string[];
  /**
   * Bindings rows in source-iteration order. Multiplicity is preserved (no
   * dedup); callers that want bag semantics consume the array as-is.
   */
  rows: TabularRow[];
}

/**
 * Sibling of {@link resolveAnonymousView} for tabular diff: load the upstream
 * (glob, empty, or view), run the user's arbitrary SELECT against it, and
 * return the bindings rows.
 *
 * Endpoint upstreams dispatch via Comunica federation pass-through — the
 * SELECT runs on the endpoint over the SPARQL protocol and bindings stream
 * back. Materialization is rejected for endpoint upstreams in the tabular
 * path (it would be wrong both for performance and because the SELECT may
 * not project triples).
 */
export async function resolveAnonymousSelectBindings(
  input: AnonymousSelectBindingsInput,
): Promise<AnonymousSelectBindingsResult> {
  const hasQuery = input.query !== undefined;
  const hasQueryFile = input.queryFile !== undefined;
  if (hasQuery && hasQueryFile) {
    throw new Error(
      '`query` and `queryFile` are mutually exclusive on an anonymous select-bindings resolver',
    );
  }
  if (!hasQuery && !hasQueryFile) {
    throw new Error(
      'an anonymous select-bindings resolver requires exactly one of `query` or `queryFile`',
    );
  }

  const query = hasQuery
    ? (input.query as string)
    : await readFile(
        resolvePath(process.cwd(), input.queryFile as string),
        'utf8',
      );

  validateViewQuery(query, { mode: 'tabular-anon' });
  const shape = detectSelectShape(query);

  const upstream = parseSourceSpec(input.source);
  if (upstream.kind === 'reference') {
    throw new Error(
      'anonymous select-bindings: `@id` reference upstreams are not supported here',
    );
  }

  const engine = input.engine ?? new ComunicaQueryEngine();

  if (upstream.kind === 'endpoint') {
    return runPassThrough(engine, upstream, query, shape.variables);
  }

  const siblingRegistry = parseSourceSpecs(
    (input.registry ?? []) as SourceSpecInput[],
  );
  const fullRegistry: ParsedSource[] = [upstream, ...siblingRegistry];
  const sources = await resolveSource(upstream, { registry: fullRegistry });
  if (sources.mode !== 'materialized') {
    throw new Error(
      'anonymous select-bindings: endpoint upstream cannot be materialized in tabular diff (use pass-through)',
    );
  }

  const result = await engine.query(query, { sources: [sources.store] });
  return collectBindings(result, shape.variables);
}

async function runPassThrough(
  engine: ComunicaQueryEngine,
  endpoint: ParsedEndpointSource,
  query: string,
  variables: string[],
): Promise<AnonymousSelectBindingsResult> {
  try {
    const result = await engine.query(
      query,
      buildEndpointContext(endpoint) as Parameters<
        ComunicaQueryEngine['query']
      >[1],
    );
    return await collectBindings(result, variables);
  } catch (err) {
    throw new Error(
      `endpoint ${endpoint.endpoint}: ${describeEndpointError(err)}`,
    );
  }
}

async function collectBindings(
  result: Awaited<ReturnType<ComunicaQueryEngine['query']>>,
  variables: string[],
): Promise<AnonymousSelectBindingsResult> {
  if (result.resultType !== 'bindings') {
    throw new Error(
      `anonymous select-bindings: expected SELECT (bindings), got ${result.resultType}`,
    );
  }
  const bindings = await result.execute();
  const rows: TabularRow[] = [];
  for await (const b of bindings as AsyncIterable<{
    get(name: string): Term | undefined;
  }>) {
    const row: TabularRow = {};
    for (const v of variables) {
      row[v] = b.get(v);
    }
    rows.push(row);
  }
  return { variables, rows };
}
