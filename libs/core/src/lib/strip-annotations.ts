import { Store } from 'n3';
import type { AnnotationPredicateIris } from './source-record-builder';

/**
 * Return a new Store containing only asserted triples — annotation triples
 * (whose predicate matches one of the configured IRIs) and any quad whose
 * subject is a quoted triple are dropped.
 *
 * The configured predicate IRIs come from the `annotate` transform; pass
 * {@link DEFAULT_ANNOTATION_PREDICATE_IRIS} when no override is in effect.
 *
 * Does not mutate the input store.
 */
export function stripAnnotations(
  store: Store,
  predicates: AnnotationPredicateIris,
): Store {
  const annotationPredicateIris = new Set([
    predicates.source,
    predicates.file,
    predicates.line,
    predicates.endLine,
  ]);
  const out = new Store();
  for (const q of store.getQuads(null, null, null, null)) {
    // n3.js types omit RDF-star quoted triples in `subject.termType`, but the
    // runtime emits 'Quad' for the quoted-triple subject of a source record.
    if ((q.subject.termType as string) === 'Quad') continue;
    if (annotationPredicateIris.has(q.predicate.value)) continue;
    out.addQuad(q);
  }
  return out;
}
