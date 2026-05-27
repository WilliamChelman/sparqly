---
status: accepted
---

# `query` RDF output formats: TriG, N-Quads, and triple-shaped SELECT reification

## Context

The `query` command currently serialises RDF results (CONSTRUCT, DESCRIBE) to `turtle` only; `json` is available for all query types. Two gaps surfaced:

1. **No quad-preserving output.** A glob that carries named graphs can be queried, but `--format turtle` flattens quads silently. Users who want to merge-and-re-serialise a multi-graph source (e.g. `sparqly query "data/**/*.trig" --query '...' --out merged.nq`) have no quad-safe output path.

2. **Triple-shaped SELECT not reifiable at the CLI.** The webapp's query page already detects `SELECT ?s ?p ?o` / `SELECT ?s ?p ?o ?g` result shapes and offers a Turtle/TriG download alongside the tabular view (`reifySelectSpo`). The CLI has no equivalent: a user running `select-spog` quick-query patterns against a source cannot pipe the result to an RDF file without rewriting it as CONSTRUCT.

The `format` command serialises Turtle and TriG but operates file-by-file and has no path to serialise a resolved multi-file source as a unit. A new `export` command was considered and rejected in favour of extending `query` — see Considered alternatives.

## Decision

**Add `trig` and `nquads` to `query`'s `--format` list. When an RDF format is requested and the query is a triple-shaped SELECT, reify the result rows as triples/quads before serialisation.**

- **New formats**: `trig` (TriG, `application/trig`) and `nquads` (N-Quads, `application/n-quads`) join `turtle` and `json` as accepted values for `--format`.

- **Extension inference**: `--out` path inference extended — `.trig` → `trig`; `.nq` and `.nquads` → `nquads`. Existing `.ttl` → `turtle` unchanged.

- **Triple-shaped SELECT reification**: when `--format` is `turtle`, `trig`, or `nquads` and the executed query is `SELECT ?s ?p ?o` or `SELECT ?s ?p ?o ?g` (variable names position-independent), the result set is reified as triples/quads and serialised in the requested format. A non-triple-shaped SELECT paired with an RDF format is a hard error naming the variable mismatch. CONSTRUCT always serialises directly without reification.

- **Unbound `?g`**: result rows where `?g` is unbound are promoted to the default graph, not dropped. Dropping silently loses data; erroring is too strict (a `GRAPH ?g { ?s ?p ?o }` pattern against a source with a populated default graph legitimately yields unbound `?g` rows).

- **No auto-detection**: the reification path is gated on an explicit `--format` value — the command never auto-switches from JSON to RDF based on detected variable shape. The webapp's auto-switch (clicking the "turtle" tab) is a UI affordance; at the CLI, implicit format switching breaks pipeline scripts that expect JSON from SELECT.

- **`ntriples` deferred.** N-Triples is a strict subset of N-Quads; there is no use case today that N-Quads does not cover. It can be added without an ADR when a concrete need appears.

## Considered alternatives

- **New `export` command** — `sparqly export "data/**/*.ttl" --out merged.ttl` with an implicit "dump everything" semantic. Rejected: the extra command surface is not justified when `query` with a default CONSTRUCT and `--format nquads` covers the same need. `export` would also require its own output-format and extension-inference logic duplicating what `query` already has. The "merge files" use case is addressed as a documented recipe (`docs/recipes.md`) instead.

- **Auto-detect format from variable shape** — if the SELECT projects `?s ?p ?o ?g` and no `--format` is given, silently emit N-Quads. Rejected: changes the default output of an existing query without user action, breaks pipelines that feed JSON results into downstream tools, and mirrors none of the webapp's own behaviour (the webapp keeps the table tab as default and requires explicit user action to see RDF output).

- **Require CONSTRUCT for all RDF output** — reject `--format trig` on a SELECT with an error pointing at rewriting as CONSTRUCT. Rejected: the webapp already offers reification as a first-class affordance; denying parity at the CLI forces mechanical query rewrites that carry no semantic value.

- **`ntriples` alongside `nquads`** — add both at once. Deferred: N-Triples would only be useful when the source is known to be triple-only, which the user can already obtain with `--format turtle`. No concrete demand today.

## Consequences

- **`query` gains a clean path for "merge and re-serialise"** use cases without a new top-level command.

- **`--format` accepted values expand** from `['json', 'turtle']` to `['json', 'turtle', 'trig', 'nquads']`. Existing invocations are unaffected.

- **Extension inference table grows** by two entries. `--out` without `--format` on a `.trig` or `.nq`/`.nquads` path now implies an RDF format and triggers the triple-shape check on SELECT queries. Users passing `--out result.nq` with a non-triple SELECT see a clear error rather than a silently wrong JSON file named `.nq`.

- **`CONTEXT.md` updated**: **Triple-shaped SELECT** added as a defined term; the `query` relationship line extended with the reification and format-inference rules.

- **`docs/recipes.md` created**: documents the merge-files recipe (`sparqly query "data/**/*.ttl" --query 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' --out merged.ttl` and the quad-preserving variant with `--format nquads`).
