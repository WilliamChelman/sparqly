---
status: accepted
amends: 0015
---

# Shallow endpoint describe with UI-driven path expansion

## Context

ADR-0015 gave `describeEndpoint` the same algorithm contract as `describeStore`: emit the seed's quads, then expand at every blank node to a fixpoint. Over the wire that meant iterative `CONSTRUCT`s fetching the blank-node closure `DEPTH_CHUNK` (4) levels at a time, escalating (4 → 8 → 12 → …, up to `MAX_DEPTH` 64) until the description stopped growing — each round a `CONSTRUCT` whose `WHERE` is a `UNION` over chain lengths `0..depth`, every length-`k` branch a `k`-step all-predicates-unbound property path with `isBlank` filters. On a blank-node-heavy seed against a large public endpoint that's a sequence of escalating-cost queries fired at someone else's server with no user in the loop — and the depth-`k` `UNION` is exactly the shape Virtuoso rejects (`SQ142`), which forced the two-queries-not-one workaround. The cost is borne remotely; the benefit (full chain depth without asking) is marginal for an interactive exploration page where the user can ask for more.

The materialized path (`describeStore`) has none of this problem — it's local `store.match` over an in-memory `Store`, so the fixpoint is free. The asymmetry between "I have the whole graph in memory" and "I'm talking to someone else's endpoint" is real and worth honouring in the algorithm rather than papering over.

## Decision

**Endpoint describe is depth-0.** `describeEndpoint` issues one query per direction — `CONSTRUCT { ?s ?p ?o } WHERE { { <seed> ?p ?o } UNION { ?s ?p <seed> } }` (split into two queries if the single `UNION` form still trips `SQ142` — cheap insurance) — plus the existing best-effort RDF-star post-pass over the small result. No escalation loop, no `DEPTH_CHUNK`, no `MAX_DEPTH`, no `UNION`-over-all-path-lengths closure query. Blank nodes in the result come back unexpanded (dangling); the source's entry is flagged `truncated` when dangling bnodes remain.

**`describeStore` is unchanged** — `glob`/`view` targets still get the full symmetric blank-node fixpoint. Views over endpoints materialize (ADR-0015), so declaring a view is the escape hatch for "I always want the full chain from a remote source."

**Going deeper is an explicit UI gesture, expressed as expansion paths on the existing `/api/describe`.** No new route. The request body gains:

```
expandedPaths?: { [sourceId: string]: PathStep[][] }   // PathStep = { predicate: string, inverse: boolean }
```

Each `PathStep[]` is one path from the seed IRI. Per named source, the server walks each path one blank-node hop further — `{ <seed> <p1> ?m1 } FILTER(isBlank(?m1)) { ?m1 <p2> ?m2 } FILTER(isBlank(?m2)) … { ?mN ?p ?o }`, plus the inverse-direction variant per `inverse: true` step — and unions the result into that source's depth-0 description before merge. Sources absent from the map: depth-0. Materialized sources: paths are ignored (already fully expanded). The request stays a pure function: `{ iri, sources, expandedPaths }` in, complete merged result out, no server state.

The webapp renders an **expand affordance** on every dangling blank node that came from an `endpoint` source (recoverable because **Describe bnode rewrite** prefixes labels with the `@id`). Clicking it appends that node's path-from-the-seed — which the client reads off the quads it already rendered, so the predicates are *known* and the walk query pins them (strictly tighter than the old blind `?e${i}` walk) — to `expandedPaths` and re-calls `/api/describe`. The fresh response replaces the affected source's slice wholesale (bnode labels are internally consistent within one response; no splice/rewire puzzle, no ambiguity hazard). Path length is capped (~12 steps); past the cap the affordance is hidden and the source is flagged `truncated`. Because the predicate (not the bnode — bnodes have no portable identity over the wire) is what's pinned, expanding one of several sibling bnodes reached by the *same* predicate co-expands the siblings; this is accepted (mildly desirable — fewer clicks).

The `describe:` config block keeps only its caps (`perSourceSoftLimit`, `perSourceHardLimit`, `fromSourcePredicate`). No `endpointBlankNodeDepth` knob — a fixed-depth-N default just reintroduces an auto-fired multi-hop query; depth is always 0 by default and deeper is always a click.

## Considered alternatives

- **Keep ADR-0015's iterative fixpoint.** Rejected: escalating-cost queries fired at a remote endpoint with no user in the loop, and the `UNION`-over-depths query is the one that needs the Virtuoso workaround. The point of an interactive describe page is that the user can ask for more — so don't pre-fetch the whole chain on their behalf.
- **A `describe.endpointBlankNodeDepth` config knob (default low, raisable).** Rejected: any fixed depth > 0 is an auto-fired multi-hop query — the thing we're removing — just at a smaller fixed size. The expand affordance covers "I want deeper" without a knob; the view-over-endpoint route covers "I always want the full chain."
- **Expand by re-running at depth+1** (button bumps a depth parameter, re-issues the whole describe). Rejected: a depth+1 fetch is still the `UNION`-over-all-paths-of-all-lengths query whose cost we're removing — now user-triggered and one-shot rather than looping, but the same expensive shape. Path-targeted expansion sends one known, predicate-pinned path instead.
- **A dedicated `POST /api/describe/expand` route returning just the new hop, spliced client-side.** Rejected: blank nodes returned over the wire carry fresh serializer-minted labels that don't match what the client is rendering, so the client would have to rewire by predicate sequence from the seed — ambiguous when a predicate repeats. Re-rendering the source's whole slice from a declarative `expandedPaths` avoids the rewire entirely and keeps `/api/describe` the single entry point.
- **Drop endpoint describe entirely (reject `endpoint` targets like `empty`).** Rejected: describing a public endpoint directly (Wikidata, DBpedia, a Virtuoso instance) is a primary use of the page; forcing a view declaration first is needless friction. Depth-0 is cheap and useful on its own.
- **Drop the symmetric `describeStore` fixpoint too, for consistency.** Rejected: it's local `store.match`, costs nothing, and is exactly the high-value behaviour on blank-node-heavy data (RDF lists, OWL restrictions, SHACL shapes). The materialized/endpoint asymmetry is the *correct* asymmetry — it tracks who pays for the traversal.

## Consequences

- **`libs/core`**: `describeEndpoint` loses the escalation loop, `DEPTH_CHUNK`, `MAX_DEPTH`, and the `UNION`-over-all-path-lengths closure-query builder; gains a depth-0 fetch and a small "walk these explicit, predicate-pinned paths one hop" builder (fixed length, bound predicates, user-initiated). `describeStore`, `relabelBnodes`, the wire codec, and the provenance builder are untouched. The Virtuoso `SQ142` rationale mostly evaporates (no giant `BIND`-laden `UNION`); the two-queries split is kept only as cheap insurance for the depth-0 form.
- **`libs/server`**: `/api/describe` request body gains optional `expandedPaths`; per-source dispatch unions the path-walk results into `endpoint` sources' descriptions before merge. No new route.
- **Webapp**: the describe page gains an expand affordance on dangling `endpoint`-origin blank nodes (path computed client-side from rendered quads, capped length); clicking re-calls `/api/describe` with an extended `expandedPaths` and replaces the affected source's slice.
- **CONTEXT.md**: **Describe**, **Describe page**, and **Describe block** updated for the depth-0 endpoint contract and `expandedPaths`; a new note that `describeEndpoint` is not a fixpoint.
- **Behavioural change**: describing an `endpoint` source now shows direct neighbours only until the user expands; previously it pulled the full blank-node chain automatically. `glob`/`view` describe is unchanged. No config-file break (the removed knob never shipped).
- **ADR-0015**: its "endpoint = iterative CONSTRUCTs to a fixpoint" decision is superseded by this ADR; everything else in ADR-0015 (the algorithm for `describeStore`, multi-source merge, bnode rewrite, provenance, the page UX, the caps) stands.
