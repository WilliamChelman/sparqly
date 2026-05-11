import { canonize } from 'rdf-canonize';
import type { Store } from 'n3';
import { parseGraphNameTransform } from '../graph-name-transform';
import { loadRdf, type GraphMode } from '../engine';
import {
  DEFAULT_ANNOTATION_PREDICATE_IRIS,
  type AnnotationPredicateIris,
} from '../source-record-builder';
import { stripAnnotations } from './strip-annotations';
import { applyTransformPipeline } from '../transform-pipeline';
import type { ParsedTransform } from '../transform-spec';
import { extractAnnotationPredicates } from '../annotate-transform';

export interface CanonicalizeOptions {
  sources: string | string[];
  /**
   * Optional default `graphName` mode. Synthesized into a `graphName`
   * transform applied to the loaded store before canonicalization. Sources
   * expressed via the source-spec should declare their own `transforms`
   * pipeline (see ADR-0006); this option is reserved for programmatic
   * callers that want a per-call default.
   */
  graphMode?: GraphMode;
}

export interface CanonicalizeStoreOptions {
  /**
   * Predicate IRIs identifying annotation triples to strip before RDFC-1.0
   * normalization. Defaults to {@link DEFAULT_ANNOTATION_PREDICATE_IRIS};
   * pass values from {@link extractAnnotationPredicates} when the source's
   * `annotate` transform overrides any of them.
   */
  annotationPredicates?: AnnotationPredicateIris;
}

export interface CanonicalizeStoreResult {
  /** RDFC-1.0 canonical N-Quads, joined with '\n' and a trailing newline. */
  canonicalText: string;
  /** Canonical N-Quads statements, one element per quad, no trailing newline. */
  canonicalStatements: string[];
  /**
   * Mapping from each input blank-node label (as it appeared in the asserted
   * portion of the input store) to the canonical label issued by RDFC-1.0
   * (e.g. `c14n0`). Populated for every blank node referenced by an asserted
   * quad; empty when the input contained no blank nodes.
   */
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
