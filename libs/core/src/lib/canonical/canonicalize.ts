import { canonize } from 'rdf-canonize';
import type { Quad, Store, Term } from 'n3';
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
  const quads = stripped.getQuads(null, null, null, null);
  assertCanonicalizable(quads);
  const canonicalIdMap = new Map<string, string>();
  const canonicalText = await canonize(
    quads,
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

/**
 * Guard against terms RDFC-1.0 cannot serialize. An empty-value `NamedNode`
 * (a relative `<>` IRI parsed without a base, or an empty IRI from a SPARQL
 * endpoint) collapses to a `DefaultGraph` term once stored in an n3 `Store`;
 * `rdf-canonize` then treats that subject/predicate/object as a literal and
 * crashes with an opaque `Cannot read properties of undefined (reading
 * 'value')`. We surface a clear, located error first.
 */
function assertCanonicalizable(quads: readonly Quad[]): void {
  for (const q of quads) {
    for (const position of ['subject', 'predicate', 'object'] as const) {
      // A `DefaultGraph` is only valid in graph position; anywhere else it is
      // the degenerate empty-IRI marker described above. n3's types exclude
      // `DefaultGraph` from S/P/O, so the cast reflects the runtime quirk.
      if ((q[position].termType as string) === 'DefaultGraph') {
        throw new Error(
          `Cannot canonicalize: the ${position} of a quad is a degenerate ` +
            `empty IRI (it collapses to the default graph and RDFC-1.0 cannot ` +
            `serialize it). This usually comes from an empty relative IRI '<>' ` +
            `parsed without a base IRI, or an empty IRI returned by a SPARQL ` +
            `endpoint. Offending triple: ${renderTriple(q)}`,
        );
      }
    }
  }
}

function renderTriple(q: Quad): string {
  return `${renderTerm(q.subject)} ${renderTerm(q.predicate)} ${renderTerm(
    q.object,
  )} .`;
}

function renderTerm(term: Term): string {
  if (term.termType === 'DefaultGraph') return '<empty>';
  if (term.termType === 'NamedNode') {
    return term.value.length > 0 ? `<${term.value}>` : '<empty>';
  }
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  return JSON.stringify(term.value);
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
