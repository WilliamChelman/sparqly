import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import { loadRdf } from './rdf-loader';
import {
  type ParsedSource,
  type ParsedViewSource,
} from './source-spec';
import { validateViewQuery } from './view-query-validate';

export interface ResolveViewOptions {
  view: ParsedViewSource;
  registry: ReadonlyArray<ParsedSource>;
}

export async function resolveView(
  opts: ResolveViewOptions,
): Promise<Store> {
  const { view, registry } = opts;
  const query = await loadViewQuery(view);
  validateViewQuery(query);

  const upstreamStore = await loadUpstream(view, registry, [view.id]);
  return runViewQuery(upstreamStore, query);
}

async function loadViewQuery(view: ParsedViewSource): Promise<string> {
  if (view.query !== undefined) return view.query;
  if (view.queryFile !== undefined) {
    const path = resolvePath(process.cwd(), view.queryFile);
    return readFile(path, 'utf8');
  }
  throw new Error(
    `view "${view.id}": exactly one of \`query\` or \`queryFile\` is required`,
  );
}

async function loadUpstream(
  view: ParsedViewSource,
  registry: ReadonlyArray<ParsedSource>,
  stack: ReadonlyArray<string>,
): Promise<Store> {
  const merged = new Store();
  const byId = buildRegistryById(registry);
  for (const refId of view.from) {
    if (stack.includes(refId)) {
      throw new Error(
        `view "${view.id}": cycle detected on \`from:\` ref @${refId} (chain: ${stack
          .map((id) => `@${id}`)
          .join(' -> ')} -> @${refId})`,
      );
    }
    const upstream = byId.get(refId);
    if (!upstream) {
      const known = [...byId.keys()];
      const list =
        known.length === 0 ? '<none>' : known.map((k) => `@${k}`).join(', ');
      throw new Error(
        `view "${view.id}": unknown @id reference "@${refId}"; defined ids: ${list}`,
      );
    }
    if (upstream.kind === 'view') {
      throw new Error(
        `view "${view.id}": view-on-view upstream "@${refId}" is not yet supported in this release`,
      );
    }
    if (upstream.kind === 'endpoint') {
      throw new Error(
        `view "${view.id}": endpoint upstream "@${refId}" is not yet supported in this release`,
      );
    }
    if (upstream.kind === 'reference') {
      throw new Error(
        `view "${view.id}": reference upstream "@${refId}" is not yet supported`,
      );
    }
    const sub = await loadRdf({
      sources: upstream.glob,
      graphMode: upstream.graphMode ?? 'preserve',
    });
    for (const quad of sub.store.getQuads(null, null, null, null)) {
      merged.addQuad(quad);
    }
  }
  return merged;
}

function buildRegistryById(
  registry: ReadonlyArray<ParsedSource>,
): Map<string, ParsedSource> {
  const map = new Map<string, ParsedSource>();
  for (const src of registry) {
    if (src.kind === 'reference') continue;
    if (src.id === undefined) continue;
    map.set(src.id, src);
  }
  return map;
}

async function runViewQuery(
  source: Store,
  query: string,
): Promise<Store> {
  const engine = new ComunicaQueryEngine();
  const out = new Store();
  const result = await engine.query(query, { sources: [source] });
  if (result.resultType === 'bindings') {
    const bindings = await result.execute();
    for await (const b of bindings as AsyncIterable<{
      get(name: string): Quad['subject'] | Quad['predicate'] | Quad['object'] | undefined;
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
}
