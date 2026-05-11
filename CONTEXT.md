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
A view synthesized at command time from `--query`/`--query-file` (or per-side `--left-query`/`--right-query` on `diff`) on `hash` or `diff`. Same resolution semantics as a declared view; never cached. Built by `resolveAnonymousView`. In `diff`, an anonymous view's query may additionally project an arbitrary SELECT tuple (not restricted to `{?s,?p,?o[,?g]}`), which selects **tabular diff** over **graph diff**; declared views and `hash` retain the triple-only restriction.

**Upstream**:
The single source a view references via `from:`. May be a glob, endpoint, empty, or another view (in which case resolution recurses).

**Materialized resolution**:
Loading the upstream into a local in-memory `Store`, then executing the view query against that Store. The default for glob, empty, and view upstreams. For an empty upstream the Store starts empty and any data flows in via `SERVICE` clauses inside the query, dispatched by Comunica.
_Avoid_: "in-memory mode", "fetch-then-query"

**Pass-through resolution**:
Forwarding the user's query to the upstream endpoint over the SPARQL protocol via Comunica federation, so the endpoint executes it and returns only the result. Used by the `query` command when its target source is an endpoint, and by views whose `from:` is an endpoint ref. `SERVICE` clauses inside a pass-through query are evaluated by the upstream endpoint, so cross-endpoint composition via SERVICE only works if that endpoint supports it; otherwise host the query on an **empty source** instead.
_Avoid_: "pushdown" (informal; the codebase term is pass-through), "federation" (federation is the *mechanism*, pass-through is the *mode*)

**Source registry**:
The set of declared sources a command sees, derived from the config file (and/or a single inline positional). The registry may contain multiple entries because views need siblings to reference via `from:`, but a command runs against exactly one of them — the **target source**.

**Target source**:
The single source a command (`query`, `hash`, `diff`) runs against. Selected by precedence: (1) explicit positional/flag — an `@id` ref or inline glob/URL — wins; (2) the entry marked `default: true` in the registry; (3) the sole entry when the registry has exactly one source; otherwise an error listing the available `@ids`. `kind: 'reference'` is rejected as a target. Multi-source merging at the command boundary is intentionally not provided — use `SERVICE` clauses (optionally hosted on an **empty source**) for cross-source composition. `serve` is the exception — it operates on the whole registry by default (see **Registry mode** vs **Single-source mode**).
_Avoid_: "selected source", "active source"

**Default source**:
The registry entry marked `default: true`. In single-target commands (`query`, `hash`, `diff`) it is picked as the **target source** when no positional/flag is given. In `serve`'s **Registry mode** it is the source the web UI pre-selects on load. At most one entry per registry may carry the marker.

**Registry mode** (`serve`):
The default `serve` mode: every non-`reference` source in the registry is exposed simultaneously. The SPARQL surface is `/api/sparql/<id>` per `@id`; the web UI lists all sources via `/api/sources` and lets the user pick which to query and which two sides to diff. Triggered by omitting `--source`/positional. The **default source** is the SPA's initial selection. Engine startup splits by resolution mode: **materialized** sources resolve eagerly at boot (each with its own `StoreRef`, each watched independently under `--watch`); **pass-through** sources are lazy — the engine is just Comunica configured against the remote URL, no boot work, no watcher participation, errors surface on first query.

**Single-source mode** (`serve`):
The fallback `serve` mode: only one source from the registry (or an inline glob/URL via the positional) is exposed, matching pre-registry-mode behavior. Triggered by passing an explicit `--source`/positional. `/api/sources` returns the single entry; the web UI hides its source picker. Preserves quick-start gestures like `sparqly serve foo.ttl`.

**Result cache**:
The view cache's content. Stores the *result* of a view's query (bounded by the query's projection), not its upstream. Keyed on `view.id + from + query + upstream-spec`. Strategies: `ttl`, `freshness`, `everlasting`.
_Avoid_: "upstream cache", "endpoint cache"

**Freshness probe**:
An `ASK` query attached to `cache.strategy: 'freshness'`. Run on cache lookup to decide whether the cached result is still valid. For single-endpoint upstreams the ASK is itself pass-through.

**Canonicalization**:
RDFC-1.0 normalization producing a stable N-Quads serialization, used by `hash` and `diff` in **graph-diff** mode. Operates on the **asserted triples** of whatever Store the resolution produced (materialized upstream or pass-through result); **Source records** and any other RDF-star annotation triples are stripped before canonical output, so `hash` is independent of source-tracking metadata.

**Graph diff**:
The default `diff` mode, taken when both sides' queries produce triples (`CONSTRUCT` or `SELECT-{?s,?p,?o[,?g]}`). Canonicalizes each side via RDFC-1.0, set-differences the canonical N-Quads, and surfaces **Source records** when glob targets carry an **Annotate-source transformation** (implicitly, via **Auto source annotation**, or explicitly).

**Tabular diff**:
The `diff` mode taken when both sides' queries are arbitrary SELECTs projecting the same set of variable names (matched by name, not position). Bag-differences the result rows under lexical term equality with unbound variables treated as a distinct sentinel value; per distinct row the diff carries a `count` of net occurrences. Mode is auto-detected from the queries; mixed-shape queries (one CONSTRUCT/spo, one arbitrary SELECT) are rejected. **Source records** do not apply, and `rdf-patch` and `turtle` output formats are rejected. Blank nodes in the projection are rejected (no stable identity for bag keys).
_Avoid_: "bindings diff", "result-set diff", "row diff" (informal; the canonical term is **tabular diff**)

**Source transformation pipeline**:
An ordered list of declared transforms attached to a **Glob source** under `transforms:`, applied eagerly to its loaded Store before it is handed to any consumer. Each list item is an object with exactly one transform key (presence-of-key discriminator, matching the `cache:` and `empty: true` patterns elsewhere in the source-spec); the registry is closed (only sparqly-known transforms). Order is array order; each transform documents its own ordering constraints if any.
_Avoid_: "post-processors", "loader plugins"

**Graph-name transformation** (`graphName`):
A transform whose value is one of `preserve`, `fillDefault`, `forceAll`, `flatten` — the canonical home of the rules formerly expressed by the now-removed `graphMode` field on a glob source. The transform is the only home for graph-name semantics: there is no top-level `--graph-mode` flag or `SPARQLY_GRAPH_MODE` env override.

**Annotate-source transformation** (`annotateSource`):
A transform that emits a **Source record** as an RDF-star annotation on each asserted triple loaded from disk, recording where that triple was authored. Listing it on a glob source makes annotations always-on for that source's downstream consumers. Renamed from `annotate` (pre-1.0 break).

**Auto source annotation**:
The `diff` command's implicit injection of an `annotateSource` step at the head of every glob target's transform pipeline at load time, applied only in **graph-diff** mode. Applies to both inline globs (`--left=path.ttl`) and declared globs in the registry. Suppressed by `--skip-auto-source-annotation`. An explicit `annotateSource` declaration in config wins over the implicit injection (no double-apply); the explicit declaration's predicates are preserved. Scoped to `diff`'s graph mode — `query`, `serve`, `format`, `hash`, and **tabular diff** keep `annotateSource` as opt-in or out-of-scope, because surfacing source records is a graph-diff output concern (see ADR-0007) and other modes either can't use them (`hash` strips, tabular has no clean per-row provenance), would inflate result stores (`query`/`serve`), or would corrupt round-trip semantics (`format`).
_Avoid_: "annotate-by-default" (ambiguous about scope), "implicit annotate" (doesn't say what's implicit)

**Source record**:
A blank-node record reached via `sparqly:source` from an RDF-star quoted triple, with `sparqly:file` (the absolute `file://` IRI of the source file) and optionally `sparqly:line` (1-based line of the predicate-object pair, omitted when the parser cannot supply it). One record per (file, line) instance of a triple; a triple loaded from two files produces two records under the same quoted-triple subject. Each of the three predicate IRIs is independently configurable on the **Annotate transformation** (`source` / `file` / `line` keys), defaulting respectively to `urn:sparqly:source`, `urn:sparqly:file`, `urn:sparqly:line`. The `diff` command surfaces source records in every output format — inline trailing comments in `human` and `rdf-patch`, statement-level comments above each flat statement in `turtle`, a `sourceRecords` field on each entry in `json`, and as a **Source-file snippet** in `html`.
_Avoid_: "provenance triple" (implied semantics beyond what we record), "lineage record"

**Diff totals**:
The per-side magnitudes carried alongside every `diff` result. In **graph diff**, totals count each side's **post-strip asserted** quads — the same canonical N-Quads set the diff is computed over, with **Source records** and other RDF-star annotations excluded — so `left - common = removed` and `right - common = added` are arithmetic identities. In **tabular diff**, totals count each side's **total occurrences** (sum of bag multiplicities, i.e. raw row count returned by the side's SELECT), not distinct rows. Surfaced as a single contract — `# left=L right=R +x -y` — on the stderr summary line, on the leading `#` comment of every text format body (`human`, `rdf-patch`, `turtle`), as a `totals: { left, right }` field on `json`, and inside the existing `<p class="summary">` element on `html`. Stderr line follows `--quiet` (suppressed); body totals always render.
_Avoid_: "row count" (tabular only), "store size" (pre-strip and ambiguous about annotations)

**Source-file snippet**:
A span of snippet context lines centered on a **Source record**'s `line`, read from the absolute `file://` path at HTML diff render time. The window is sized by `--snippet-context K` on `diff` (and the `context` query param on `GET /api/source-snippet`). Rendered only by the `html` diff format; other formats carry only the (file, line) reference. Implies that `html` diff output is non-deterministic in source-file content — re-running `diff -f html` after editing a source file can produce a different document even when the canonicalized diff result is unchanged. Other formats remain content-deterministic.
_Avoid_: "context window" (overloaded with LLM/parsing terminology), "hunk preview", bare "context lines" (now reserved for the **Context block**)

**Describe**:
A sparqly-defined algorithm that computes a symmetric concise bounded description of a seed IRI against a single Store-or-endpoint: emit every quad whose subject or object equals the seed, then expand at every blank node in either position to a fixpoint, capped by a per-source quad limit. Does *not* traverse to other named IRIs — named-IRI fanout is a UI click-through concern, not an algorithm concern. RDF-star annotations are included only when their quoted triple is already in the result set (a single post-pass after the fixpoint); annotations on quoted triples not already in the set are not pulled in. Distinct from SPARQL's `DESCRIBE` verb, whose semantics are implementation-defined; the codebase deliberately does not delegate to native `DESCRIBE`. Implemented in `libs/core` as two primitives — `describeStore` (materialized path, for `glob`/`view` targets) and `describeEndpoint` (pass-through path, for `endpoint` targets via Comunica iterative CONSTRUCTs over the wire). `empty` is rejected as a describe target (no data to describe; only meaningful as a view's upstream with `SERVICE`).
_Avoid_: "CBD" (the asymmetric W3C-note variant; sparqly's describe is symmetric), conflating with SPARQL `DESCRIBE` (different semantics), "expand entity" (vague about depth and direction).

**Describe page**:
The webapp surface at `/describe?iri=<encoded>&sources=<csv>` that runs **describe** of a seed IRI across one or more registry sources and renders the merged result. Available in both **Registry mode** and **Single-source mode** (the source picker collapses to the single available source in the latter, mirroring the query/diff pages). Initial state on first load selects all sources; zero sources selected produces an empty result with a "Select all" affordance — `[0..n]` is honest, 0 is not aliased to "all". Backed by `POST /api/describe`.

**Describe-this affordance**:
A click-through control rendered next to every named IRI in the webapp's structured RDF renderers — the query page's term cells (SELECT bindings and CONSTRUCT triples), the diff page's tabular cells, and the **Describe page**'s own quad table. Activating it opens `/describe?iri=<fully-expanded>` in a new tab. It attaches to named IRIs only — never to bnodes, literals, or graph names — and the link always carries the *expanded* IRI, not a prefixed form, so it survives deployments with different prefix maps. This is the user gesture behind "named-IRI fanout is a UI concern, not an algorithm concern": the **describe** algorithm itself never traverses to other named IRIs; one-hop pivots happen only when a user clicks. Implemented as a shared `app-describe-link` component (`apps/web/src/app/modules/describe-link`).
_Avoid_: putting the affordance on the textual diff-hunk line renderer (it renders pre-formatted N-Quads strings, not structured terms — out of scope), "auto-expand" (traversal never happens automatically).

**Describe provenance**:
A sparqly-injected RDF-star annotation emitted per (quad, origin-source) pair by `/api/describe` when `withProvenance: true` (default). Default predicate `urn:sparqly:fromSource`, configurable on the request; subject is the quoted quad `<< s p o g >>`, object is an `xsd:string` literal carrying the source `@id` verbatim. Source `@id`s are config-key strings, not IRIs — the string-literal object avoids inventing a synthetic IRI scheme. Same quad returned from multiple sources receives one annotation per source. The webapp renderer strips these annotations on receipt, deduplicates the underlying quads by lexical (s, p, o, g), and presents source membership as per-quad UI badges — user-authored RDF-star annotations remain visible inline. Wire-format RDF-star + side-band-semantics at render time. Distinct from **Source records**: those record *file authorship* (file path + line) populated by the **Annotate-source transformation**; **describe provenance** records *registry membership* (which `@id` returned the quad) populated by `/api/describe`. The two never share a predicate IRI.
_Avoid_: conflating with **Source records** or the **Annotate-source transformation**, "from-graph annotation" (the graph name is preserved separately; provenance is the source `@id`, not the graph IRI).

**Describe bnode rewrite**:
A deterministic per-source bnode-label rewrite applied at `/api/describe` merge time: every bnode label `_:x` returned from source `foo` is rewritten to `_:foo__x` (or equivalent prefix scheme) before quads enter the merged set. Bnodes are document-scoped in RDF — `_:b1` from two different sources are not the same node — so naive label-match dedup would silently conflate them. The rewrite gives every source a disjoint bnode label space, so the post-merge lexical-(s,p,o,g) dedup is correct: IRI-only quads collapse across sources (badged with each origin), bnode-containing quads never collapse (one merged quad per origin). Implemented in `libs/core` as a `relabelBnodes(quads, prefix)` primitive next to `describeStore`/`describeEndpoint`.
_Avoid_: "bnode canonicalization" (a stronger operation — RDFC-1.0 — used only by **Canonicalization** for `hash`/`diff`; the describe rewrite is a cheap label-prefix pass that does **not** canonicalize).

**Describe response counts**:
The `count` value in `perSource[id]` on a `/api/describe` response is **post-dedup membership**: the number of merged quads whose badge set includes this source — i.e. quads this source contributed to the final response (not the raw count it returned before merge). The sum of all `count`s exceeds the merged `total` whenever any IRI-only quad was returned from more than one source (badged with each origin), which is the common case for `rdf:type` and similar registry-wide predicates. The `total` field on the response carries the count of merged quads — the size of the displayed result. A `truncated: true` on a source's entry reports that the **describe** algorithm hit `perSourceLimit` for that source *before* merge; the merged `total` may still be smaller than `count` if cross-source dedup collapsed IRI-only quads.
_Avoid_: "row count" (overloaded with **Tabular diff**'s totals semantics), reading `sum(count) == total` (it doesn't — that's by design).

**Describe block**:
The top-level `describe:` block in the project config, carrying registry-wide describe defaults: `{ perSourceSoftLimit?: number, perSourceHardLimit?: number, fromSourcePredicate?: string }`. `perSourceSoftLimit` (default `10000`) is the per-source quad cap applied when a `/api/describe` request omits `perSourceLimit`. `perSourceHardLimit` (default `100000`) is the absolute ceiling a request-supplied `perSourceLimit` cannot exceed. `fromSourcePredicate` overrides the default `urn:sparqly:fromSource` annotation predicate. Read by `/api/describe`; surfaced to the webapp via `GET /api/config`. Per-source truncation surfaces as `truncated: true` on each source's entry in the response — the flag reports *whether* the cap fired, not the cap value itself.
_Avoid_: conflating soft and hard limits (soft = default; hard = ceiling), "describe cache" (no caching is defined here — the result cache applies to views, not describe).

**Context block**:
The top-level `context:` block in the project config, carrying registry-wide IRI display config: `{ prefixes: Record<string, string>, base?: string }`. Named after JSON-LD's `@context` for the prefix-map + base semantic; the in-file shape uses sparqly-internal subkeys (`prefixes:` and `base:`), not the literal JSON-LD spelling. Read by every command that declares a `prefixes` or `base` field (today: `format`, `diff`, `query`) — the runner treats `context:` as a top-tier layer alongside `sources:`, flattening `context.prefixes` → field `prefixes` and `context.base` → field `base`, with no per-command opt-in. The effective renderer prefix map is `DEFAULT_PREFIXES` (rdf, rdfs, owl, xsd) ∪ `context.prefixes` with config winning on conflicts; `context.base` is a strict-fallback short-form (`<localname>`) for IRIs no prefix matches. Surfaced to the webapp via `GET /api/config` so the diff renderer applies the same rules to tabular cells, hunk anchors, and hunk lines. The block is config-only — there are no `--prefix`/`--prefixes`/`--base` CLI overrides.
_Avoid_: "format block" (`format:` no longer carries prefixes/base — only `objectAnchoredPredicates` remains), "display config", "prefix block"

## Relationships

- A **View** has exactly one **Upstream** source via `from:`.
- An **Upstream** is itself a **Source** (glob, endpoint, empty, or view; reference is rejected).
- A **View** whose `from:` is an **Endpoint source** resolves via **pass-through**; glob, empty, and view upstreams resolve via **materialized**.
- A **View** with `cache:` declared writes to the **Result cache** after resolution; `cache.strategy: 'freshness'` triggers a **Freshness probe** on lookup. On an **empty source** view the probe must contain `SERVICE` clauses to be meaningful, since the local Store is empty.
- The **`query` command** picks one **target source** from the **source registry** and resolves it: **pass-through** when the target is an endpoint, **materialized** otherwise (glob, empty, view).
- The **`serve` command** in **Registry mode** exposes every non-`reference` source from the **source registry** as `/api/sparql/<id>`, plus a `/api/diff` surface that pairs any two `@id`s; in **Single-source mode** it picks one **target source** and exposes it as a single `/api/sparql` endpoint, using the same resolution rules as `query`.
- **`hash`** picks one **target source** and always **canonicalizes** the resolved Store; it refuses raw endpoints (must be wrapped in a view) and refuses arbitrary-SELECT views — `hash` requires triples.
- **`diff`** picks one **target source** per side and dispatches by query shape: **graph diff** when both sides produce triples; **tabular diff** when both sides project arbitrary SELECT tuples with matching variable names. Mixed-shape pairs are rejected. Both modes refuse a raw endpoint as target — endpoints must be wrapped in a view (declared or anonymous) so a scoping query exists.
- A **Glob source** may declare a **Source transformation pipeline**; transforms run in array order at load time before the Store is exposed to resolution.
- The **Annotate-source transformation** populates **Source records** on the glob's own asserted triples; annotations do not propagate through a downstream **View** unless that view's query explicitly references them, and they are stripped by **Canonicalization**.
- `diff` injects **Auto source annotation** by default for any glob target it loads (inline or declared), unless `--skip-auto-source-annotation` is passed; an explicit `annotateSource` declaration in config takes precedence, preserving custom predicate IRIs.
- `diff` (in **graph-diff** mode) extracts **Source records** per side after **Canonicalization** and surfaces them across every graph output format; the `html` format additionally renders a **Source-file snippet** per record, reading the source file from disk at render time. **Tabular diff** carries no source records.
- Every command that renders IRIs (`format`'s Turtle/TriG output, `diff`'s `human`/`rdf-patch`/`turtle`/`html` output, `query`'s Turtle output, the webapp's diff renderer for tabular cells, hunk anchors, and hunk lines, the webapp's query-page turtle/trig view) reads from the **Context block** under one rule: prefix map = `DEFAULT_PREFIXES` ∪ `context.prefixes` (config wins); base = `context.base` as strict fallback after prefix match. The webapp consumes the block via `GET /api/config` (a registry-wide static payload combining `sources`, `context`, and `describe`).
- The **Describe page** issues `POST /api/describe` against the registry, which dispatches per source kind: `glob`/`view` targets materialize via `resolveSource` and run the **describe** algorithm against the resulting Store (`describeStore`); `endpoint` targets run iterative CONSTRUCTs over the wire (`describeEndpoint`); `empty` is rejected as a top-level describe target; `reference` is rejected per ADR-0005. Per-source caps come from the **Describe block** (soft default, hard ceiling).
- `/api/describe` is a best-effort multi-origin surface: one source failing does not fail the request. Per-source outcomes — `{ count, truncated, error? }` — are returned in `perSource[id]`. HTTP 200 if any source succeeded; HTTP 502 only when all selected sources failed. **Describe provenance** annotations (RDF-star `urn:sparqly:fromSource`) are stripped by the webapp renderer and surfaced as UI badges; they never conflate with user-authored RDF-star or with **Source records**.

## Example dialogue

> **Dev:** "We're hashing a 50M-triple **endpoint** with `--query` to scope to a tiny subset, but the process OOMs."
> **Maintainer:** "It was resolving as **materialized** — pulling the whole endpoint into a local Store before applying the query. Single-endpoint **anonymous views** now use **pass-through**, so your query reaches the endpoint and only the result comes back."
> **Dev:** "Will the **result cache** save the next run?"
> **Maintainer:** "Yes — the cache stores the query's *result*, not the upstream. Either resolution path produces the same cached entry, keyed on the same fields."

## Flagged ambiguities

- **"Materialize"** had been used in command help text to mean both "load upstream into a Store" and "produce the final result"; resolved — **materialized** refers only to the upstream-loading resolution path. A view's output is "produced" or "computed", never "materialized".
- **"Cache the upstream"** confused users who expected the cache to grow with endpoint size; resolved — the **result cache** stores the view's *output*, bounded by the view query.
- **"Pushdown"** appeared informally as a synonym for what the codebase calls **pass-through**; resolved — the canonical term is **pass-through**, matching `QuerySources.mode` in `loadQuerySources`.
- **"`annotate` transform"** (legacy name from ADR-0006) was renamed to **`annotateSource`** to disambiguate from a hypothetical future "annotate by inference" or "annotate by SHACL"; resolved — only `annotateSource` parses (pre-1.0 hard rename).
- **"context"** carried two meanings until grilling on 2026-05-07: (a) snippet context lines on `diff`'s `html` output, surfaced as the CLI flag `--context K` and the prose "context lines" in **Source-file snippet**, and (b) JSON-LD-style display config (prefix map + base). Resolved — the CLI flag renames to `--snippet-context K`, the **Source-file snippet** definition speaks of "snippet context lines", and the unqualified noun **context** refers only to the **Context block**. Pre-1.0 hard rename, no compat shim — same precedent as `annotateSource`.
