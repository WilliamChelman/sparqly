import { Store } from 'n3';
import { err, ok, type Result } from 'neverthrow';
import type { TransformParseError } from './errors';
import {
  buildSourceRecord,
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from './source-record-builder';
import type {
  ParsedTransform,
  ParsedTransformResult,
  TransformApply,
  TransformContext,
  TransformDefinition,
} from './transform-spec';

const KEY = 'annotateSource';
const KNOWN_KEYS = new Set(['source', 'file', 'line', 'endLine']);

/**
 * Primary `Result`-typed impl of the `annotateSource` transform parser.
 * Invalid specs surface as a `TransformParseError` carrying the
 * `annotateSource` key and the legacy thrown message (ADR-0024).
 */
export function parseAnnotateTransformResult(
  raw: unknown,
): Result<ParsedTransformResult, TransformParseError> {
  return parseAnnotateSpecResult(raw).map((predicates) => ({
    apply: (store, ctx) => applyAnnotate(store, ctx, predicates),
    config: predicates,
  }));
}

/**
 * @deprecated Use {@link parseAnnotateTransformResult} (ADR-0024). Retained
 * as a thin throw-wrapping adapter for the `transform-spec.ts` registry path,
 * which still surfaces parse failures as throws (Surface B, out of scope for
 * the #243 conversion).
 */
export function parseAnnotateTransform(raw: unknown): TransformApply {
  const result = parseAnnotateTransformResult(raw);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value.apply;
}

export const ANNOTATE_SOURCE_TRANSFORM: TransformDefinition = {
  key: KEY,
  parse: (raw) => {
    const result = parseAnnotateTransformResult(raw);
    if (result.isErr()) {
      throw new Error(result.error.message);
    }
    return result.value;
  },
};

/**
 * Pull the configured annotation predicate IRIs out of a parsed transforms
 * list — returns the override when the source declared `annotateSource`
 * (with or without overrides), or the defaults otherwise. Used by the
 * canonicalize / hash / diff layer to thread the right predicates into the
 * stripper. The matched key is `annotateSource`.
 */
export function extractAnnotationPredicates(
  transforms: ReadonlyArray<ParsedTransform> | undefined,
): AnnotationPredicateIris {
  if (!transforms) return { ...DEFAULT_ANNOTATION_PREDICATE_IRIS };
  for (const t of transforms) {
    if (t.key === KEY && isPredicateIris(t.config)) return t.config;
  }
  return { ...DEFAULT_ANNOTATION_PREDICATE_IRIS };
}

/**
 * True when the parsed transforms list declares an `annotateSource`
 * transform (with or without overrides). Used by `diff` to decide whether a
 * side is "annotated" for the purpose of the mixed-sides stderr summary
 * line — intent-based, not record-presence-based, so an empty annotated
 * source still counts as annotated. The matched key is `annotateSource`.
 */
export function hasAnnotateTransform(
  transforms: ReadonlyArray<ParsedTransform> | undefined,
): boolean {
  if (!transforms) return false;
  for (const t of transforms) {
    if (t.key === KEY) return true;
  }
  return false;
}

function isPredicateIris(value: unknown): value is AnnotationPredicateIris {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['source'] === 'string' &&
    typeof v['file'] === 'string' &&
    typeof v['line'] === 'string' &&
    typeof v['endLine'] === 'string'
  );
}

function transformParseErr(message: string): TransformParseError {
  return { kind: 'transform-parse', transformKey: KEY, message };
}

function parseAnnotateSpecResult(
  raw: unknown,
): Result<AnnotationPredicateIris, TransformParseError> {
  if (raw === undefined || raw === null) {
    return ok({ ...DEFAULT_ANNOTATION_PREDICATE_IRIS });
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return err(
      transformParseErr(
        `\`${KEY}\` must be omitted, \`null\`, or an object \`{ source?, file?, line?, endLine? }\``,
      ),
    );
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      return err(
        transformParseErr(
          `\`${KEY}\`: unknown key "${key}" (known: source, file, line, endLine)`,
        ),
      );
    }
  }
  const source = pickIriResult(obj, 'source');
  if (source.isErr()) return err(source.error);
  const file = pickIriResult(obj, 'file');
  if (file.isErr()) return err(file.error);
  const line = pickIriResult(obj, 'line');
  if (line.isErr()) return err(line.error);
  const endLine = pickIriResult(obj, 'endLine');
  if (endLine.isErr()) return err(endLine.error);
  return ok({
    source: source.value ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.source,
    file: file.value ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.file,
    line: line.value ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.line,
    endLine: endLine.value ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.endLine,
  });
}

function pickIriResult(
  obj: Record<string, unknown>,
  key: 'source' | 'file' | 'line' | 'endLine',
): Result<string | undefined, TransformParseError> {
  const v = obj[key];
  if (v === undefined) return ok(undefined);
  if (typeof v !== 'string' || v.length === 0) {
    return err(
      transformParseErr(`\`${KEY}\`: \`${key}\` must be a non-empty IRI string`),
    );
  }
  return ok(v);
}

function applyAnnotate(
  store: Store,
  ctx: TransformContext | undefined,
  predicates: AnnotationPredicateIris,
): Store {
  const perFileRecords = ctx?.perFileRecords;
  if (!perFileRecords) {
    throw new Error(
      `\`${KEY}\` requires per-file context from the loader; apply via the source pipeline (resolveSource/loadSources)`,
    );
  }
  const out = new Store();
  for (const q of store.getQuads(null, null, null, null)) out.addQuad(q);
  for (const [file, records] of perFileRecords) {
    for (const record of records) {
      const recordQuads = buildSourceRecord({
        asserted: record.quad,
        filePath: file,
        line: record.line,
        endLine: record.endLine,
        predicates,
      });
      for (const q of recordQuads) out.addQuad(q);
    }
  }
  return out;
}
