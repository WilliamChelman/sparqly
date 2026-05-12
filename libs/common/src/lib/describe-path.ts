/**
 * One hop of a UI-driven blank-node expansion path from the seed IRI (ADR-0019).
 *
 * `predicate` is the pinned predicate IRI of the hop; `inverse` is `true` when
 * the seed (or prior path node) is the *object* of that triple rather than the
 * subject. Shared by the `libs/core` path-expansion query builder and the
 * `/api/describe` request DTO.
 */
export interface PathStep {
  predicate: string;
  inverse: boolean;
}
