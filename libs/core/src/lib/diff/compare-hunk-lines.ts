import type { HunkLine } from './group-rdf-diff-by-entity';

export function compareHunkLines(a: HunkLine, b: HunkLine): number {
  if (a.subjectPath !== b.subjectPath) {
    return a.subjectPath < b.subjectPath ? -1 : 1;
  }
  if (a.predicate !== b.predicate) {
    return a.predicate < b.predicate ? -1 : 1;
  }
  // Same (subject, predicate) cluster: `-` precedes `+`.
  if (a.side !== b.side) return a.side === '-' ? -1 : 1;
  // Stable tie-break by object form so output is deterministic.
  if (a.object !== b.object) return a.object < b.object ? -1 : 1;
  return 0;
}
