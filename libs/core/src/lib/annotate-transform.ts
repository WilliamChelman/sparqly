import { Store } from 'n3';
import {
  buildSourceRecord,
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from './source-record-builder';
import type {
  TransformApply,
  TransformContext,
  TransformDefinition,
} from './transform-spec';

const KEY = 'annotate';
const KNOWN_KEYS = new Set(['source', 'file', 'line']);

export function parseAnnotateTransform(raw: unknown): TransformApply {
  const predicates = parseAnnotateSpec(raw);
  return (store, ctx) => applyAnnotate(store, ctx, predicates);
}

export const ANNOTATE_TRANSFORM: TransformDefinition = {
  key: KEY,
  parse: parseAnnotateTransform,
};

function parseAnnotateSpec(raw: unknown): AnnotationPredicateIris {
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_ANNOTATION_PREDICATE_IRIS };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `\`${KEY}\` must be omitted, \`null\`, or an object \`{ source?, file?, line? }\``,
    );
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(
        `\`${KEY}\`: unknown key "${key}" (known: source, file, line)`,
      );
    }
  }
  return {
    source: pickIri(obj, 'source') ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.source,
    file: pickIri(obj, 'file') ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.file,
    line: pickIri(obj, 'line') ?? DEFAULT_ANNOTATION_PREDICATE_IRIS.line,
  };
}

function pickIri(
  obj: Record<string, unknown>,
  key: 'source' | 'file' | 'line',
): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `\`${KEY}\`: \`${key}\` must be a non-empty IRI string`,
    );
  }
  return v;
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
        predicates,
      });
      for (const q of recordQuads) out.addQuad(q);
    }
  }
  return out;
}
