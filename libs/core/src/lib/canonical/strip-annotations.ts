import { Store } from 'n3';
import type { AnnotationPredicateIris } from '../sources';

/** Return a new Store with annotation triples and quoted-triple-subject quads removed. */
export function stripAnnotations(
  store: Store,
  predicates: AnnotationPredicateIris,
): Store {
  const annotationPredicateIris = new Set([
    predicates.source,
    predicates.file,
    predicates.line,
    predicates.endLine,
    predicates.gitRef,
    predicates.gitSha,
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
