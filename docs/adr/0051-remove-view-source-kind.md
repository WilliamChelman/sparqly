---
status: accepted
supersedes: ADR-0003, ADR-0004
---

# Remove the `view` source kind; derivation is an inline query, not a source

A **view** was a first-class `Source` that scoped a single upstream via a SPARQL query (`CONSTRUCT` / triple-shaped `SELECT`), composable into chains through `from:`. It carried a large amount of dedicated machinery — `from:` chain walking, leaf-glob resolution, pin propagation down the chain, a result cache with three strategies (ttl / freshness / everlasting), and a materialized-vs-pass-through fork keyed on the upstream chain — roughly 2050 LOC in `libs/core/src/lib/views/` plus comparable specs. In practice nobody declared views in config (not the live config, not the fixtures); the machinery was exercised almost entirely through the *anonymous* path: an inline query passed to `query`/`hash`/`diff`. We are removing `view` as a source kind to collapse the source mental model onto a single axis — "a source is data that physically exists" — and making derivation a *verb* (an inline query at command time) rather than a *noun* (a named, `@id`-addressable source).

## What replaces it

- **Derivation over an endpoint** (the load-bearing case: scope a huge endpoint to hash/diff a subset) stays as an **inline query** resolved via pass-through. The anonymous-view code path survives, reframed as "the command's query" — no `Source` is involved.
- **Derivation over a glob** (static files) is replaced by a **disk store**: bake the result with `query -o derived.nq`, then declare a glob source over the file (optionally `storage: disk`, rebuilt when inputs change). Derivation moves out of the source model and into the user's shell/build step.
- **SERVICE composition** runs against an **Empty source** as a neutral inline-query target — unchanged in behaviour, only re-described (it no longer "hosts a view").
- **Pinning** applies directly to glob sources (`@data:v1.2`); there is no chain to propagate a ref through.

## Considered options

- **Keep views, reframe as materialized views** (compute-once, persist to disk, expose as a plain source). Rejected: it keeps a query-defined source kind and reintroduces staleness/freshness questions; the simplification is mostly lost.
- **Add a `materialize`/`bake` command** that does query → persist → register-as-disk-source in one step. Rejected for now: it is the named-query-defined-source concept under a new name. The long-game in-tool derivation path is instead a *writable* `Empty` disk store fed by SPARQL `UPDATE` — derivation as mutation, not as a source kind (a separate, later slice).

## Consequences

- The **result cache** is removed entirely; a repeated scoped-endpoint `hash`/`diff` re-runs the query each time.
- `serve` can no longer expose a named, *live*-derived dataset. Static derivations are served by baking to a disk source; live endpoint-derived datasets must wait for the writable empty-store.
- ADR-0031 (lazy materialization) and ADR-0050 (worker pool) keep their behaviour but lose all "view upstream / chain" language. The glossary terms **View**, **Upstream**, **Anonymous view**, and **Result cache** are retired; **Inline query** is the canonical replacement term.
