# Tabular diff for arbitrary SELECT queries

## Status

Accepted.

## Context

`diff` previously canonicalized triples on each side and set-differenced the canonical N-Quads. View queries — declared or anonymous — were validated to produce triples (`CONSTRUCT` or `SELECT-{?s,?p,?o[,?g]}`). Users wanted to compare two arbitrary SELECT result sets — for example, validating that a refactored query against one source produces the same rows as the original against another source.

## Decision

Add **tabular diff** as a second mode of `diff`, dispatched by query shape:

- Both sides produce triples → existing **graph diff** path (unchanged).
- Both sides project an arbitrary SELECT tuple → **tabular diff**: bag-difference of bindings rows.
- Mixed shapes → rejected.

Tabular diff is supported only via `diff`'s **anonymous views** (CLI `--query` / `--left-query` / `--right-query`). Declared views and `hash` keep the triple-only restriction. The two queries on a tabular diff may differ; their projected variable-name sets must match exactly (matching is by name, not position).

## Considered alternatives

- **Globally relax view-query validation** so any SELECT projection produces a legal view. Rejected: ripples into `query`, `serve`, and `hash`, each of which would need its own per-shape rules — exactly what view-query validation centralized.
- **Separate `diff-query` / `diff-bindings` command**. Rejected: two commands with overlapping "compare two things" semantics, and ADR-0005's "single target source at command boundary" already pushed against shape proliferation. The existing `--left/--right` plumbing fits the new mode cleanly.

## Semantics

- **Column matching**: by variable name (set match). No positional matching, no aliasing flags. Aliasing is the user's job (`SELECT (?personName AS ?name) …`).
- **Multiplicity**: bag (multiset). A row that appears 3× left and 5× right contributes `+2` of that row. Output carries a `count` per distinct row; default `1` is elided in JSON.
- **Term equality**: lexical/syntactic, matching graph-diff's RDFC-1.0 semantics. `"30"^^xsd:integer ≠ "30"^^xsd:int`. SPARQL value equality is intentionally *not* implemented (partial, complex, divergent from graph-diff).
- **Unbound variables**: treated as a distinct sentinel value — total and order-preserving. SPARQL's "errors on unbound comparison" rule is scoped to expression evaluation, not result-set comparison.
- **Blank nodes in projection**: rejected. Blank-node labels lack stable identity across runs, so bag-keying on them is ill-defined; refusing is better than silently producing garbage.
- **`ORDER BY` / `LIMIT` / `OFFSET`**: accepted permissively. A warning is emitted on stderr when `LIMIT`/`OFFSET` is used without `ORDER BY` (silent non-determinism trap).
- **Endpoint targets**: pass-through — the SELECT runs on the endpoint and bindings come back. Materialization would be wrong both for performance and because the SELECT may not project triples.
- **Output**: rows are sorted lexicographically by canonical serialization within each `added`/`removed` block. Output is deterministic regardless of return order.
- **Output formats**: `human`, `json`, `html` reuse their names with mode-aware rendering. `rdf-patch` and `turtle` are rejected in tabular mode (RDF-shaped formats have no meaning for tuple results).
- **Source records**: not surfaced. A row derived from a JOIN has no clean per-row provenance, and best-effort heuristics would mislead more than they help. **Auto source annotation** is suppressed in tabular mode.

## Consequences

- View-query validation diverges by call site: declared views and `hash`-mounted anonymous views still demand triples; `diff`-mounted anonymous views accept arbitrary SELECT.
- The `json` output shape branches on mode. Consumers scripting against `-f json` must already know which mode they're invoking; the divergence is unavoidable.
- Tabular results are not cached. Anonymous views were never cached anyway, so this is consistent with prior behavior.
- Future work — e.g., per-row provenance via Comunica's annotated-bindings, or value-equality term comparison — is non-breaking to add later (stricter→looser changes).
