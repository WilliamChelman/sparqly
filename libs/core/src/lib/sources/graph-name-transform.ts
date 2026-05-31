import { DataFactory, Store, type DefaultGraph, type NamedNode, type Quad } from 'n3';
import { err, ok, type Result } from 'neverthrow';
import { GRAPH_MODES, type GraphMode } from '../engine';
import type { TransformParseError } from './errors';
import type {
  ParsedTransform,
  ParsedTransformResult,
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

// JSON-serializable snapshot of the parsed spec — the mode plus the graph
// override IRI — so a change to either marks the disk-backed index stale.
export interface GraphNameConfig {
  mode: GraphMode;
  graph?: string;
}

export function parseGraphNameTransformResult(
  raw: unknown,
): Result<ParsedTransformResult, TransformParseError> {
  return parseGraphNameSpecResult(raw).map((spec) => ({
    apply: buildApply(spec),
    config: specToConfig(spec),
  }));
}

// Per-quad rewrite for one file. Driven by {@link GraphNameConfig} so the
// streamed disk-backed ingest can apply it quad-by-quad without an n3.Store
// or the per-file record side-channel {@link rewriteWithFileGraphs} needs.
export function graphNameQuadRewriter(
  config: GraphNameConfig,
  file: string,
): (quad: Quad) => Quad {
  if (config.mode === 'preserve') return (q) => q;
  if (config.mode === 'flatten') {
    const dg = DataFactory.defaultGraph();
    return (q) => rewriteGraph(q, dg);
  }
  const target = config.graph
    ? DataFactory.namedNode(config.graph)
    : DataFactory.namedNode(`file://${file}`);
  if (config.mode === 'fillDefault') {
    return (q) =>
      q.graph.termType === 'DefaultGraph' ? rewriteGraph(q, target) : q;
  }
  return (q) => rewriteGraph(q, target);
}

/** Snapshots a parsed spec into the JSON-serializable manifest config. */
function specToConfig(spec: GraphNameSpec): GraphNameConfig {
  return spec.graph === undefined
    ? { mode: spec.mode }
    : { mode: spec.mode, graph: spec.graph.value };
}

// Declared `transforms` verbatim when present; otherwise synthesizes a
// `graphName` transform from the resolver's default {@link GraphMode}.
export function effectiveTransforms(
  declaredTransforms: ReadonlyArray<ParsedTransform> | undefined,
  defaultGraphMode: GraphMode | undefined,
): Result<ReadonlyArray<ParsedTransform>, TransformParseError> {
  if (declaredTransforms !== undefined) return ok(declaredTransforms);
  if (defaultGraphMode === undefined || defaultGraphMode === 'preserve') {
    return ok([]);
  }
  return parseGraphNameTransformResult(defaultGraphMode).map((result) => [
    { key: KEY, apply: result.apply, config: result.config },
  ]);
}

export const GRAPH_NAME_TRANSFORM: TransformDefinition = {
  key: KEY,
  parse: (raw) => {
    const result = parseGraphNameTransformResult(raw);
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  },
};

function transformParseErr(message: string): TransformParseError {
  return { kind: 'transform-parse', transformKey: KEY, message };
}

function parseGraphNameSpecResult(
  raw: unknown,
): Result<GraphNameSpec, TransformParseError> {
  if (typeof raw === 'string') {
    return parseModeResult(raw).map((mode) => ({ mode }));
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err(
      transformParseErr(
        `\`${KEY}\` must be a mode string or an object \`{ mode, graph? }\``,
      ),
    );
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      return err(
        transformParseErr(
          `\`${KEY}\`: unknown key "${key}" (known: mode, graph)`,
        ),
      );
    }
  }
  const rawMode = obj['mode'];
  if (rawMode === undefined) {
    return err(transformParseErr(`\`${KEY}\`: \`mode\` is required in the long form`));
  }
  if (typeof rawMode !== 'string') {
    return err(transformParseErr(`\`${KEY}\`: \`mode\` must be a string`));
  }
  return parseModeResult(rawMode).andThen((mode) => {
    const rawGraph = obj['graph'];
    if (rawGraph === undefined) return ok({ mode });
    if (typeof rawGraph !== 'string' || rawGraph.length === 0) {
      return err(
        transformParseErr(`\`${KEY}\`: \`graph\` must be a non-empty IRI string`),
      );
    }
    if (GRAPH_OVERRIDE_FORBIDDEN.has(mode)) {
      return err(
        transformParseErr(
          `\`${KEY}\`: \`graph\` is meaningless with mode "${mode}" (only forceAll and fillDefault accept an override)`,
        ),
      );
    }
    return ok({ mode, graph: DataFactory.namedNode(rawGraph) });
  });
}

function parseModeResult(raw: string): Result<GraphMode, TransformParseError> {
  if ((GRAPH_MODES as ReadonlyArray<string>).includes(raw)) {
    return ok(raw as GraphMode);
  }
  return err(
    transformParseErr(
      `\`${KEY}\`: unknown mode "${raw}" (valid: preserve, fillDefault, forceAll, flatten)`,
    ),
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
      `\`${KEY}\` mode "${spec.mode}" requires per-file context from the loader; apply the transform via the source pipeline (resolveSource)`,
    );
  }
  const config = specToConfig(spec);
  const out = new Store();
  for (const [file, records] of perFileRecords) {
    const rewrite = graphNameQuadRewriter(config, file);
    for (const record of records) out.addQuad(rewrite(record.quad));
  }
  return out;
}

function rewriteGraph(q: Quad, target: NamedNode | DefaultGraph): Quad {
  return DataFactory.quad(q.subject, q.predicate, q.object, target);
}
