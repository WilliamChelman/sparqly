import type { Quad, Term } from 'n3';
import type { PathStep } from 'common';

/**
 * UI-side support for **describe expansion paths** (ADR-0019).
 *
 * The describe page renders an in-place expand affordance on every *dangling*
 * blank node that came from an `endpoint` source. "Dangling" means the node
 * appears in the rendered result but has no quad with it in subject position —
 * `describeEndpoint` is depth-0, so the seed's blank-node neighbours come back
 * unexpanded. Clicking the affordance walks that node one hop deeper by re-calling
 * `/api/describe` with the node's predicate-pinned path-from-the-seed appended to
 * `expandedPaths`.
 *
 * These helpers are pure — they operate on the already-rendered, provenance-
 * stripped quad set and the rewritten (`sourceId__`-prefixed) blank-node label.
 */

/** Separator the **Describe bnode rewrite** uses: `${sourceId}__${originalLabel}`. */
const REWRITE_SEPARATOR = '__';

/** Cap on expansion-path length (ADR-0019); past it the affordance is hidden. */
export const MAX_EXPANSION_PATH_STEPS = 12;

export interface DescribeBnodePathResult {
  /** The `endpoint` source the dangling node came from. */
  sourceId: string;
  /** Predicate-pinned path from the seed IRI to the dangling node. */
  path: PathStep[];
}

/**
 * Recover the originating source id from a rewritten blank-node label.
 * Returns `null` when the label has no rewrite prefix (e.g. a label minted by a
 * serializer rather than relabelled per source).
 */
export function recoverSourceId(bnodeLabel: string): string | null {
  const idx = bnodeLabel.indexOf(REWRITE_SEPARATOR);
  if (idx <= 0) return null;
  return bnodeLabel.slice(0, idx);
}

/**
 * Shortest predicate-pinned path from `seedIri` to the blank node `bnodeLabel`,
 * walking only through blank-node hops, plus the node's originating source id.
 * Returns `null` when the label carries no source-id prefix or no such path
 * exists in `quads`.
 */
export function describeBnodePath(
  quads: ReadonlyArray<Quad>,
  bnodeLabel: string,
  seedIri: string,
): DescribeBnodePathResult | null {
  const sourceId = recoverSourceId(bnodeLabel);
  if (sourceId === null) return null;

  const startKey = `N:${seedIri}`;
  const targetKey = `B:${bnodeLabel}`;
  if (startKey === targetKey) return null;

  const seen = new Set<string>([startKey]);
  let frontier: { key: string; path: PathStep[] }[] = [{ key: startKey, path: [] }];
  while (frontier.length > 0) {
    const nextFrontier: { key: string; path: PathStep[] }[] = [];
    for (const node of frontier) {
      for (const q of quads) {
        const sKey = termKey(q.subject);
        const oKey = termKey(q.object);
        // Forward: the current node is the subject, step into a blank-node object.
        if (sKey === node.key && q.object.termType === 'BlankNode') {
          const path = [...node.path, { predicate: q.predicate.value, inverse: false }];
          if (oKey === targetKey) return { sourceId, path };
          if (!seen.has(oKey)) {
            seen.add(oKey);
            nextFrontier.push({ key: oKey, path });
          }
        }
        // Inverse: the current node is the object, step into a blank-node subject.
        if (oKey === node.key && q.subject.termType === 'BlankNode') {
          const path = [...node.path, { predicate: q.predicate.value, inverse: true }];
          if (sKey === targetKey) return { sourceId, path };
          if (!seen.has(sKey)) {
            seen.add(sKey);
            nextFrontier.push({ key: sKey, path });
          }
        }
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

/**
 * Does `bnodeLabel` qualify for the expand affordance? True when its source is
 * one of `endpointSourceIds` and it is dangling — present in `quads` but never
 * in subject position.
 */
export function isExpandableBnode(
  quads: ReadonlyArray<Quad>,
  bnodeLabel: string,
  endpointSourceIds: ReadonlySet<string>,
): boolean {
  const sourceId = recoverSourceId(bnodeLabel);
  if (sourceId === null || !endpointSourceIds.has(sourceId)) return false;
  let appears = false;
  for (const q of quads) {
    if (q.subject.termType === 'BlankNode' && q.subject.value === bnodeLabel) {
      return false;
    }
    if (q.object.termType === 'BlankNode' && q.object.value === bnodeLabel) {
      appears = true;
    }
  }
  return appears;
}

function termKey(t: Term): string {
  if (t.termType === 'BlankNode') return `B:${t.value}`;
  if (t.termType === 'NamedNode') return `N:${t.value}`;
  return `X:${t.termType}:${t.value}`;
}
