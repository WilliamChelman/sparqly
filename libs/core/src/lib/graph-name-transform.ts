import { DataFactory, Store, type DefaultGraph, type NamedNode, type Quad } from 'n3';
import { GRAPH_MODES, type GraphMode } from './engine';
import type {
  TransformApply,
  TransformContext,
  TransformDefinition,
} from './transform-spec';

const KEY = 'graphName';
const KNOWN_KEYS = new Set(['mode', 'graph']);
const GRAPH_OVERRIDE_FORBIDDEN = new Set<GraphMode>(['preserve', 'flatten']);

interface GraphNameSpec {
  mode: GraphMode;
  graph?: NamedNode;
}

export function parseGraphNameTransform(raw: unknown): TransformApply {
  const spec = parseGraphNameSpec(raw);
  return buildApply(spec);
}

export const GRAPH_NAME_TRANSFORM: TransformDefinition = {
  key: KEY,
  parse: parseGraphNameTransform,
};

function parseGraphNameSpec(raw: unknown): GraphNameSpec {
  if (typeof raw === 'string') {
    return { mode: parseMode(raw) };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `\`${KEY}\` must be a mode string or an object \`{ mode, graph? }\``,
    );
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`\`${KEY}\`: unknown key "${key}" (known: mode, graph)`);
    }
  }
  const rawMode = obj['mode'];
  if (rawMode === undefined) {
    throw new Error(`\`${KEY}\`: \`mode\` is required in the long form`);
  }
  if (typeof rawMode !== 'string') {
    throw new Error(`\`${KEY}\`: \`mode\` must be a string`);
  }
  const mode = parseMode(rawMode);
  const rawGraph = obj['graph'];
  if (rawGraph === undefined) return { mode };
  if (typeof rawGraph !== 'string' || rawGraph.length === 0) {
    throw new Error(`\`${KEY}\`: \`graph\` must be a non-empty IRI string`);
  }
  if (GRAPH_OVERRIDE_FORBIDDEN.has(mode)) {
    throw new Error(
      `\`${KEY}\`: \`graph\` is meaningless with mode "${mode}" (only forceAll and fillDefault accept an override)`,
    );
  }
  return { mode, graph: DataFactory.namedNode(rawGraph) };
}

function parseMode(raw: string): GraphMode {
  if ((GRAPH_MODES as ReadonlyArray<string>).includes(raw)) {
    return raw as GraphMode;
  }
  throw new Error(
    `\`${KEY}\`: unknown mode "${raw}" (valid: preserve, fillDefault, forceAll, flatten)`,
  );
}

function buildApply(spec: GraphNameSpec): TransformApply {
  if (spec.mode === 'preserve') return identity;
  if (spec.mode === 'flatten') return rewriteFlatten;
  return (store, ctx) => rewriteWithFileGraphs(store, ctx, spec);
}

function identity(store: Store): Store {
  return store;
}

function rewriteFlatten(store: Store): Store {
  const out = new Store();
  const dg = DataFactory.defaultGraph();
  for (const q of store.getQuads(null, null, null, null)) {
    out.addQuad(rewriteGraph(q, dg));
  }
  return out;
}

function rewriteWithFileGraphs(
  store: Store,
  ctx: TransformContext | undefined,
  spec: GraphNameSpec,
): Store {
  const perFileRecords = ctx?.perFileRecords;
  if (!perFileRecords) {
    throw new Error(
      `\`${KEY}\` mode "${spec.mode}" requires per-file context from the loader; apply the transform via the source pipeline (resolveSource/loadSources)`,
    );
  }
  const out = new Store();
  for (const [file, records] of perFileRecords) {
    const fileGraph = DataFactory.namedNode(`file://${file}`);
    for (const record of records) {
      out.addQuad(rewriteForMode(record.quad, spec, fileGraph));
    }
  }
  return out;
}

function rewriteForMode(
  q: Quad,
  spec: GraphNameSpec,
  fileGraph: NamedNode,
): Quad {
  if (spec.mode === 'forceAll') {
    return rewriteGraph(q, spec.graph ?? fileGraph);
  }
  // fillDefault
  if (q.graph.termType === 'DefaultGraph') {
    return rewriteGraph(q, spec.graph ?? fileGraph);
  }
  return q;
}

function rewriteGraph(q: Quad, target: NamedNode | DefaultGraph): Quad {
  return DataFactory.quad(q.subject, q.predicate, q.object, target);
}
