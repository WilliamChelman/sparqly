import { canonize } from 'rdf-canonize';
import type { Store } from 'n3';
import { parseGraphNameTransform } from '../sources';
import { loadRdf, type GraphMode } from '../engine';
import {
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from '../sources';
import { stripAnnotations } from './strip-annotations';
import { applyTransformPipeline } from '../sources';
import type { ParsedTransform } from '../sources';
import { extractAnnotationPredicates } from '../sources';

export interface CanonicalizeOptions {
  sources: string | string[];
  /** Default `graphName` mode for programmatic callers (see ADR-0006). */
  graphMode?: GraphMode;
}

export interface CanonicalizeStoreOptions {
  /** Annotation predicate IRIs to strip; defaults to {@link DEFAULT_ANNOTATION_PREDICATE_IRIS}. */
  annotationPredicates?: AnnotationPredicateIris;
}

export interface CanonicalizeStoreResult {
  /** RDFC-1.0 canonical N-Quads, joined with '\n' and a trailing newline. */
  canonicalText: string;
  /** Canonical N-Quads statements, one element per quad, no trailing newline. */
  canonicalStatements: string[];
  /** Map from input bnode labels to RDFC-1.0 canonical labels; empty if no bnodes. */
  canonicalIdMap: Map<string, string>;
}

export interface CanonicalizeResult extends CanonicalizeStoreResult {
  files: string[];
  store: Store;
  /** Prefixes declared in each parsed file, keyed by absolute file path. */
  prefixes: Record<string, Record<string, string>>;
}

export async function canonicalizeStore(
  store: Store,
  options: CanonicalizeStoreOptions = {},
): Promise<CanonicalizeStoreResult> {
  const predicates =
    options.annotationPredicates ?? DEFAULT_ANNOTATION_PREDICATE_IRIS;
  const stripped = stripAnnotations(store, predicates);
  const canonicalIdMap = new Map<string, string>();
  const canonicalText = await canonize(
    stripped.getQuads(null, null, null, null),
    {
      algorithm: 'RDFC-1.0',
      format: 'application/n-quads',
      canonicalIdMap,
    },
  );
  const canonicalStatements = canonicalText
    .split('\n')
    .filter((line: string) => line.length > 0);
  return { canonicalText, canonicalStatements, canonicalIdMap };
}

export async function canonicalizeRdf(
  options: CanonicalizeOptions,
): Promise<CanonicalizeResult> {
  const loaded = await loadRdf({ sources: options.sources });
  const transforms: ReadonlyArray<ParsedTransform> =
    options.graphMode === undefined || options.graphMode === 'preserve'
      ? []
      : [
          {
            key: 'graphName',
            apply: parseGraphNameTransform(options.graphMode),
          },
        ];
  const transformed = applyTransformPipeline(loaded.store, transforms, {
    perFileRecords: loaded.perFileRecords,
  });
  const { canonicalText, canonicalStatements, canonicalIdMap } =
    await canonicalizeStore(transformed, {
      annotationPredicates: extractAnnotationPredicates(transforms),
    });
  return {
    files: loaded.files,
    store: transformed,
    prefixes: loaded.prefixes,
    canonicalText,
    canonicalStatements,
    canonicalIdMap,
  };
}
