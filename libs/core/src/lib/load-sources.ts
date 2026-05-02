import { QueryEngine as ComunicaQueryEngine } from '@comunica/query-sparql';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { DataFactory, Store, type Quad } from 'n3';
import {
  buildEndpointContext,
  describeEndpointError,
} from './endpoint-http';
import { validatePrefilter } from './prefilter-validate';
import { loadRdf, type GraphMode, type LoadResult } from './rdf-loader';
import {
  parseSourceSpecs,
  type ParseSourceSpecsContext,
  type ParsedEndpointSource,
  type ParsedGlobSource,
  type SourceSpecInput,
} from './source-spec';

export const NOT_SUPPORTED_TRACKING_URL =
  'https://github.com/WilliamChelman/sparqly/issues/60';

export interface LoadSourcesOptions {
  graphMode?: GraphMode;
  parseContext?: ParseSourceSpecsContext;
}

export async function loadSources(
  inputs: ReadonlyArray<SourceSpecInput>,
  options: LoadSourcesOptions = {},
): Promise<LoadResult> {
  const parsed = parseSourceSpecs(inputs, options.parseContext);
  for (const source of parsed) {
    if (source.kind === 'reference') {
      throw new Error(
        `@id reference sources are not yet supported (tracking: ${NOT_SUPPORTED_TRACKING_URL})`,
      );
    }
  }

  const resolvedPrefilters = new Map<number, string>();
  for (let i = 0; i < parsed.length; i++) {
    const source = parsed[i];
    if (source.kind === 'reference') continue;
    if (source.prefilter !== undefined) {
      validatePrefilter(source.prefilter);
      resolvedPrefilters.set(i, source.prefilter);
    } else if (source.prefilterFile !== undefined) {
      const path = resolvePath(process.cwd(), source.prefilterFile);
      const query = await readFile(path, 'utf8');
      validatePrefilter(query);
      resolvedPrefilters.set(i, query);
    }
  }

  const merged = new Store();
  const allFiles: string[] = [];
  const allPrefixes: Record<string, Record<string, string>> = {};
  const engine = new ComunicaQueryEngine();

  for (let i = 0; i < parsed.length; i++) {
    const source = parsed[i] as ParsedGlobSource | ParsedEndpointSource;
    const effectiveMode: GraphMode =
      source.graphMode ?? options.graphMode ?? 'preserve';
    const overrideGraph = source.graph
      ? DataFactory.namedNode(source.graph)
      : undefined;
    const prefilterQuery = resolvedPrefilters.get(i);

    if (source.kind === 'endpoint') {
      const sub = await loadEndpoint(engine, source);
      const syntheticGraph =
        overrideGraph ?? DataFactory.namedNode(source.endpoint);
      const after = prefilterQuery
        ? await applyPrefilter(engine, sub, prefilterQuery, {
            graphMode: effectiveMode,
            syntheticGraph,
          })
        : applyGraphMode(sub, effectiveMode, syntheticGraph);
      for (const quad of after.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      continue;
    }

    if (prefilterQuery !== undefined) {
      const sub = await loadRdf({
        sources: source.glob,
        graphMode: 'preserve',
      });
      const syntheticGraph =
        overrideGraph ??
        (sub.files.length === 1
          ? DataFactory.namedNode(`file://${sub.files[0]}`)
          : undefined);
      const after = await applyPrefilter(engine, sub.store, prefilterQuery, {
        graphMode: effectiveMode,
        syntheticGraph,
      });
      for (const quad of after.getQuads(null, null, null, null)) {
        merged.addQuad(quad);
      }
      allFiles.push(...sub.files);
      Object.assign(allPrefixes, sub.prefixes);
      continue;
    }

    const sub = await loadRdf({
      sources: source.glob,
      graphMode: effectiveMode,
    });
    const fileSyntheticIris = new Set(sub.files.map((f) => `file://${f}`));
    for (const quad of sub.store.getQuads(null, null, null, null)) {
      const rewritten =
        overrideGraph &&
        quad.graph.termType === 'NamedNode' &&
        fileSyntheticIris.has(quad.graph.value)
          ? DataFactory.quad(
              quad.subject,
              quad.predicate,
              quad.object,
              overrideGraph,
            )
          : quad;
      merged.addQuad(rewritten);
    }
    allFiles.push(...sub.files);
    Object.assign(allPrefixes, sub.prefixes);
  }

  return { store: merged, files: allFiles, prefixes: allPrefixes };
}

async function loadEndpoint(
  engine: ComunicaQueryEngine,
  source: ParsedEndpointSource,
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

function applyGraphMode(
  source: Store,
  mode: GraphMode,
  syntheticGraph: ReturnType<typeof DataFactory.namedNode>,
): Store {
  if (mode === 'preserve') return source;
  const out = new Store();
  for (const quad of source.getQuads(null, null, null, null)) {
    let graph: Quad['graph'] = quad.graph;
    if (mode === 'flatten') {
      graph = DataFactory.defaultGraph();
    } else if (mode === 'forceAll') {
      graph = syntheticGraph;
    } else if (mode === 'fillDefault' && quad.graph.termType === 'DefaultGraph') {
      graph = syntheticGraph;
    }
    out.addQuad(
      DataFactory.quad(quad.subject, quad.predicate, quad.object, graph),
    );
  }
  return out;
}

interface PrefilterPostOptions {
  graphMode: GraphMode;
  syntheticGraph: ReturnType<typeof DataFactory.namedNode> | undefined;
}

async function applyPrefilter(
  engine: ComunicaQueryEngine,
  source: Store,
  query: string,
  opts: PrefilterPostOptions,
): Promise<Store> {
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
      const graph = g
        ? (g as Quad['graph'])
        : graphFromMode(opts.graphMode, opts.syntheticGraph);
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
      const graph =
        q.graph.termType === 'DefaultGraph'
          ? graphFromMode(opts.graphMode, opts.syntheticGraph)
          : q.graph;
      out.addQuad(DataFactory.quad(q.subject, q.predicate, q.object, graph));
    }
    return out;
  }
  throw new Error(
    `Unexpected prefilter result type: ${String(result.resultType)}`,
  );
}

function graphFromMode(
  mode: GraphMode,
  syntheticGraph: ReturnType<typeof DataFactory.namedNode> | undefined,
): Quad['graph'] {
  if ((mode === 'fillDefault' || mode === 'forceAll') && syntheticGraph) {
    return syntheticGraph;
  }
  return DataFactory.defaultGraph();
}
