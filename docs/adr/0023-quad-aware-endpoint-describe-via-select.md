---
status: accepted
amends: 0019
---

# Quad-aware endpoint describe via SELECT

## Context

ADR-0019 made `describeEndpoint` depth-0: one `CONSTRUCT { ?s ?p ?o } WHERE { { <seed> ?p ?o } UNION { ?s ?p <seed> } }` per direction, plus an RDF-star post-pass, plus the small predicate-pinned **describe expansion path** walker — all `CONSTRUCT`. But `CONSTRUCT` only ever produces triples: the `GRAPH` a quad lives in is erased, every result lands in the default graph. The materialized path (`describeStore`) keeps named graphs — `glob`/`view` targets describe quads — so an `endpoint` source describing the *same* data showed strictly less than a `view` over it would. The describe page already has a quad table and a graph column; endpoint describe just never filled it.

Worse, on an endpoint where the default graph is the union of all named graphs (Virtuoso's usual configuration), a plain `CONSTRUCT { ?s ?p ?o }` *can't* see graph membership at all — the data is "in the default graph" from the query's point of view. A naive fix ("also run `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ?g { … } }`") doesn't compose: on a store where data is genuinely default-graph-only, the `GRAPH ?g` form yields zero quads; on a union-default store, the two forms return the same triple twice (once graph-less, once per named graph).

## Decision

**Endpoint direct edges are fetched with graph-aware `SELECT`, not `CONSTRUCT`.** Per direction, one query:

```
SELECT ?p ?o ?g WHERE { { <seed> ?p ?o } UNION { GRAPH ?g { <seed> ?p ?o } } }    # outgoing
SELECT ?s ?p ?g WHERE { { ?s ?p <seed> } UNION { GRAPH ?g { ?s ?p <seed> } } }    # incoming
```

A row with `?g` unbound is a default-graph quad; a bound `?g` names the graph. One round trip per direction captures both default-graph and named-graph data, so there is no separate `CONSTRUCT` fallback and the "0 quads because it's all in the default graph" failure mode is gone. The results are parsed from `application/sparql-results+json` into n3 `Term`s (a small `parseSparqlResultsJson` primitive next to `describeEndpoint`; handles URIs, plain/typed/lang literals, blank nodes, and RDF-star `triple` terms recursively).

**Default-vs-named overlap collapses toward the named copy.** Before the quads enter the describe `Store`, `preferNamedGraphs` drops any default-graph quad whose `(s, p, o)` also appears in some named graph — so a union-default endpoint shows each triple once, attributed to its real graph, while a triple that genuinely is both default-graph *and* separately asserted in a named graph still shows once (the named one; the distinction the user can act on). Distinct named graphs stay distinct.

**The describe expansion path walker is graph-aware the same way.** `buildPathExpansionQuery` becomes a `SELECT` projecting the terminal node and both edge trios with graph variables — `SELECT ?node ?eop ?eoo ?eg ?eis ?eip ?eig WHERE { …hops… { { { ?node ?eop ?eoo } UNION { GRAPH ?eg { ?node ?eop ?eoo } } } UNION { { ?eis ?eip ?node } UNION { GRAPH ?eig { ?eis ?eip ?node } } } } }`. The blank-node hop steps themselves stay graph-unscoped (a blank node's chain is not reliably confined to one graph, and pinning it would over-narrow); only the terminal fan-out, which is the part that becomes describe quads, carries the graph.

**The RDF-star provenance post-pass stays `CONSTRUCT`.** It already produces only quoted-triple-subject triples that the wire codec round-trips; nothing graph-bearing there changes. A whole-`SELECT` failure (malformed endpoint, `SQ142`-class rejection, transport error) is treated exactly as the `CONSTRUCT` failure was under ADR-0019 — that direction/path contributes nothing and the source is flagged `truncated`.

## Considered alternatives

- **Keep `CONSTRUCT`, accept default-graph-only results.** Rejected: it's a silent capability gap versus the materialized path on the same data, and unfixable for union-default endpoints (the common deployment).
- **`CONSTRUCT` for the default-graph part + a separate `GRAPH ?g` `CONSTRUCT`, merged.** Rejected: two round trips, and no clean way to de-dup the union-default double-return — the `CONSTRUCT` results are graph-less by construction, so "is this the default copy of a named triple?" is unanswerable post-hoc. The `SELECT` carries `?g`, which is exactly what de-dup needs.
- **`SELECT` only the `GRAPH ?g` form; fall back to a `CONSTRUCT` if it returns nothing.** Rejected (the original instinct): a two-phase fetch where phase 2 fires only sometimes, and "returned nothing" is ambiguous (empty seed vs. all-default-graph data) — the single `UNION` query answers both in one pass.
- **Prefer the default-graph copy, drop the named dup.** Rejected: the named graph is the more informative attribution; on a union-default endpoint "this came from graph X" is strictly more useful than "this is in the default graph (which is everything)".

## Consequences

- **`libs/core`**: new `parseSparqlResultsJson` (SPARQL JSON results → n3 `Term`s, RDF-star aware), exported from the engine barrel. `describeEndpoint` direct edges issue graph-aware `SELECT`s (one per direction) and parse JSON results instead of `CONSTRUCT` + wire codec; a `preferNamedGraphs` collapse runs before the describe `Store` is populated. `buildPathExpansionQuery` emits a graph-aware `SELECT` (terminal node + both edge trios + graph vars) instead of a `CONSTRUCT`; the blank-node hop steps stay graph-unscoped. The RDF-star post-pass and the `truncated` semantics are unchanged. `describeStore`, `relabelBnodes`, the wire codec, and the provenance builder are untouched.
- **Test infra**: the store-backed fake SPARQL endpoint answers `SELECT` (via Comunica, `application/sparql-results+json`) in addition to `CONSTRUCT`, so endpoint-describe tests exercise the real query shapes.
- **`libs/server`** and the **webapp**: no API change — `/api/describe` still returns the same merged-quads wire format; endpoint-origin quads now simply carry their graph the way `glob`/`view` ones already did. The describe page's existing graph column starts showing graphs for endpoint sources.
- **Behavioural change**: describing an `endpoint` source against a quad store (or a union-default endpoint) now shows each triple in its real named graph, de-duplicated against the default-graph echo; previously every endpoint quad was default-graph. Depth-0, the expansion-path UX, the caps, and `glob`/`view` describe are all unchanged.
- **CONTEXT.md**: **Describe**, **Describe expansion path**, and the **Describe page** dispatch note updated — `describeEndpoint` is graph-aware (`SELECT … GRAPH ?g …`), not triples-only `CONSTRUCT`; the `_Avoid_` note gains "describing endpoint describe as `CONSTRUCT`-based / triples-only (pre-ADR-0023)".
- **ADR-0019**: its "one `CONSTRUCT` per direction" mechanic is superseded by this ADR (graph-aware `SELECT` per direction); the depth-0 contract, the rejection of an `endpointBlankNodeDepth` knob, the expansion-path design, and the materialized/endpoint asymmetry rationale all stand.
