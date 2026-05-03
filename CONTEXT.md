# sparqly

A CLI for querying, hashing, diffing, formatting, and serving RDF, built around declarative source specs that compose globs of files, remote SPARQL endpoints, and views that scope upstreams via SPARQL queries.

## Language

**Source**:
A declared input that produces RDF. One of: `glob`, `endpoint`, `empty`, `view`, `reference`.

**Glob source**:
A `kind: 'glob'` source that matches RDF files on disk via a glob pattern.

**Endpoint source**:
A `kind: 'endpoint'` source whose value is the URL of a remote SPARQL HTTP endpoint.

**Empty source**:
A `kind: 'empty'` source declared with `{ id, empty: true }` that produces an empty in-memory `Store`. It exists to host a view whose query composes data via `SERVICE` clauses, so users can federate across endpoints whose own SPARQL implementation does not support `SERVICE`.

**View**:
A `kind: 'view'` source declared with `id`, `from: '@ref'` (exactly one upstream ref), and a SPARQL `query` (or `queryFile`) that scopes that upstream. Only `CONSTRUCT` and `SELECT-{?s,?p,?o[,?g]}` are accepted as the view query. Multi-source composition is intentionally not provided at the source-spec level — use `SERVICE` clauses inside the view query, optionally hosted on an **empty source**.

**Anonymous view**:
A view synthesized at command time from `--query`/`--query-file` on `hash` or `diff`. Same resolution semantics as a declared view; never cached. Built by `resolveAnonymousView`.

**Upstream**:
The single source a view references via `from:`. May be a glob, endpoint, empty, or another view (in which case resolution recurses).

**Materialized resolution**:
Loading the upstream into a local in-memory `Store`, then executing the view query against that Store. The default for glob, empty, and view upstreams. For an empty upstream the Store starts empty and any data flows in via `SERVICE` clauses inside the query, dispatched by Comunica.
_Avoid_: "in-memory mode", "fetch-then-query"

**Pass-through resolution**:
Forwarding the user's query to the upstream endpoint over the SPARQL protocol via Comunica federation, so the endpoint executes it and returns only the result. Used by the `query` command for a single endpoint source, and by views whose `from:` is an endpoint ref. `SERVICE` clauses inside a pass-through query are evaluated by the upstream endpoint, so cross-endpoint composition via SERVICE only works if that endpoint supports it; otherwise host the query on an **empty source** instead.
_Avoid_: "pushdown" (informal; the codebase term is pass-through), "federation" (federation is the *mechanism*, pass-through is the *mode*)

**Result cache**:
The view cache's content. Stores the *result* of a view's query (bounded by the query's projection), not its upstream. Keyed on `view.id + from + query + upstream-spec`. Strategies: `ttl`, `freshness`, `everlasting`.
_Avoid_: "upstream cache", "endpoint cache"

**Freshness probe**:
An `ASK` query attached to `cache.strategy: 'freshness'`. Run on cache lookup to decide whether the cached result is still valid. For single-endpoint upstreams the ASK is itself pass-through.

**Canonicalization**:
RDFC-1.0 normalization producing a stable N-Quads serialization, used by `hash` and `diff`. Operates on whatever Store the resolution produced (materialized upstream or pass-through result).

## Relationships

- A **View** has exactly one **Upstream** source via `from:`.
- An **Upstream** is itself a **Source** (glob, endpoint, empty, or view; reference is rejected).
- A **View** whose `from:` is an **Endpoint source** resolves via **pass-through**; glob, empty, and view upstreams resolve via **materialized**.
- A **View** with `cache:` declared writes to the **Result cache** after resolution; `cache.strategy: 'freshness'` triggers a **Freshness probe** on lookup. On an **empty source** view the probe must contain `SERVICE` clauses to be meaningful, since the local Store is empty.
- The **`query` command** uses **pass-through** when a single endpoint source is given; otherwise it uses **materialized** resolution via `loadQuerySources`.
- **`hash`** and **`diff`** always **canonicalize** the resolved Store and refuse a raw endpoint source — endpoints must be wrapped in a view (declared or anonymous) so a scoping query exists.

## Example dialogue

> **Dev:** "We're hashing a 50M-triple **endpoint** with `--query` to scope to a tiny subset, but the process OOMs."
> **Maintainer:** "It was resolving as **materialized** — pulling the whole endpoint into a local Store before applying the query. Single-endpoint **anonymous views** now use **pass-through**, so your query reaches the endpoint and only the result comes back."
> **Dev:** "Will the **result cache** save the next run?"
> **Maintainer:** "Yes — the cache stores the query's *result*, not the upstream. Either resolution path produces the same cached entry, keyed on the same fields."

## Flagged ambiguities

- **"Materialize"** had been used in command help text to mean both "load upstream into a Store" and "produce the final result"; resolved — **materialized** refers only to the upstream-loading resolution path. A view's output is "produced" or "computed", never "materialized".
- **"Cache the upstream"** confused users who expected the cache to grow with endpoint size; resolved — the **result cache** stores the view's *output*, bounded by the view query.
- **"Pushdown"** appeared informally as a synonym for what the codebase calls **pass-through**; resolved — the canonical term is **pass-through**, matching `QuerySources.mode` in `loadQuerySources`.
