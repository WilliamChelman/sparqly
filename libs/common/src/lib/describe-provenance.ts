import { DataFactory, type Quad, type Term } from 'n3';

const { namedNode, literal, quad: makeQuad } = DataFactory;

/**
 * Describe provenance (ADR-0015, CONTEXT.md). Wire-format RDF-star annotation
 * per (quad, origin-source) pair emitted by `/api/describe`, stripped by the
 * webapp renderer.
 *
 * - `inject(quads, sourceId, predicate)` annotates each input quad with
 *   `<<s p o g>> <predicate> "sourceId"` and returns `[...quads, ...annotations]`.
 * - `strip(quads, predicate)` removes annotations carrying that predicate and
 *   returns the surviving quads + a `(quadKey -> origins[])` map.
 *
 * Source `@id`s are config-key strings, not IRIs — the string-literal object
 * avoids inventing a synthetic IRI scheme. Distinct from **Source records**:
 * those record file authorship; this records registry membership. The two
 * never share a predicate IRI.
 */
export const describeProvenance = {
  inject(
    quads: ReadonlyArray<Quad>,
    sourceId: string,
    predicate: string,
  ): Quad[] {
    const predTerm = namedNode(predicate);
    const objTerm = literal(sourceId);
    const annotations: Quad[] = quads.map((q) =>
      makeQuad(q as unknown as Quad['subject'], predTerm, objTerm) as Quad,
    );
    return [...quads, ...annotations];
  },

  strip(
    quads: ReadonlyArray<Quad>,
    predicate: string,
  ): { quads: Quad[]; originsByQuad: Map<string, string[]> } {
    const survivors: Quad[] = [];
    const originsByQuad = new Map<string, string[]>();
    for (const q of quads) {
      if (
        (q.subject.termType as string) === 'Quad' &&
        q.predicate.value === predicate
      ) {
        const innerKey = quadKey(q.subject as unknown as Quad);
        const list = originsByQuad.get(innerKey);
        const origin = q.object.value;
        if (list) {
          if (!list.includes(origin)) list.push(origin);
        } else {
          originsByQuad.set(innerKey, [origin]);
        }
        continue;
      }
      survivors.push(q);
    }
    return { quads: survivors, originsByQuad };
  },
};

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}
