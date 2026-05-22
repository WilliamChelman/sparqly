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

/**
 * Build-time config the `graphName` transform exposes for the Glob index
 * manifest (ADR-0041). A JSON-serializable snapshot of the parsed spec — the
 * mode, plus the graph-override IRI as a string when one was declared — so a
 * change to either registers the disk-backed index as stale.
 */
export interface GraphNameConfig {
  mode: GraphMode;
  graph?: string;
}

/**
 * Primary `Result`-typed impl of the `graphName` transform parser. Invalid
 * specs surface as a `TransformParseError` carrying the `graphName` key and
 * the legacy thrown message (ADR-0024). The `config` mirrors the parsed spec
 * so the Glob index manifest can detect a transform change (ADR-0041).
 */
export function parseGraphNameTransformResult(
  raw: unknown,
): Result<ParsedTransformResult, TransformParseError> {
  return parseGraphNameSpecResult(raw).map((spec) => ({
    apply: buildApply(spec),
    config: specToConfig(spec),
  }));
}

/** Snapshots a parsed spec into the JSON-serializable manifest config. */
function specToConfig(spec: GraphNameSpec): GraphNameConfig {
  return spec.graph === undefined
    ? { mode: spec.mode }
    : { mode: spec.mode, graph: spec.graph.value };
}

/**
 * The transform pipeline to apply to a glob source: its declared `transforms`
 * verbatim when present, otherwise a `graphName` transform synthesized from
 * the resolver's default {@link GraphMode} — an empty pipeline for `preserve`
 * or no default at all.
 */
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

/**
 * @deprecated Use {@link parseGraphNameTransformResult} (ADR-0024). Retained
 * as a thin throw-wrapping adapter for the `transform-spec.ts` registry path,
 * which still surfaces parse failures as throws (Surface B, out of scope for
 * the #243 conversion).
 */
export function parseGraphNameTransform(raw: unknown): TransformApply {
  const result = parseGraphNameTransformResult(raw);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value.apply;
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
