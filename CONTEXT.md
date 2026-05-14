# sparqly

A CLI for querying, hashing, diffing, formatting, and serving RDF, built around declarative source specs that compose globs of files, remote SPARQL endpoints, and views that scope upstreams via SPARQL queries.

## Language

**Source**:
A declared input that produces RDF. One of: `glob`, `file`, `endpoint`, `empty`, `view`, `reference`. `file` sources are never user-declared — they exist only as the children of a **split glob**.

**Glob source**:
A `kind: 'glob'` source that matches RDF files on disk via a glob pattern. Empty matches warn (one `warn`-level log line through the boundary logger) and yield an empty store; they do not error (ADR-0028).

**File source**:
A `kind: 'file'` source resolving exactly one RDF file at a path. Synthesized by **registry expansion** as the child of a **split glob**; carries a `parentId` linking back to that meta. Never user-declared. Resolves like a one-file glob (materialized) and may carry an inherited **Source transformation pipeline**.
_Avoid_: "single-file glob", "leaf source"

**Split glob**:
A **Glob source** declared with `splitByFile: true`. Opt-in. The meta retains its union-of-files semantics; **registry expansion** additionally synthesizes one **File source** per matched file as a peer registry entry with id `<parentId>/<glob-relative-path>`. Empty matches warn; they do not error (see also the same behaviour on plain globs).
_Avoid_: "exploded glob", "fan-out glob"

**Registry expansion**:
A second pass after `parseSourceSpecs`, run once at startup before scope/target resolution. Walks the filesystem for every **split glob** and emits its **File source** children alongside the meta. Sync `parseSourceSpecs` stays pure (shape-only); expansion is async and owns filesystem-error surfacing. The watcher re-runs expansion per-meta when files enter or leave a split-glob's match set.
_Avoid_: "glob resolution", "registry hydration"

**Endpoint source**:
A `kind: 'endpoint'` source whose value is the URL of a remote SPARQL HTTP endpoint.

**Empty source**:
A `kind: 'empty'` source that produces an empty in-memory `Store`, intended to host a view whose query composes data via `SERVICE` clauses across endpoints that do not themselves support `SERVICE`.

**View**:
A `kind: 'view'` source that scopes exactly one upstream (`from: '@ref'`) with a SPARQL `query` (or `queryFile`); the view query must be `CONSTRUCT` or `SELECT-{?s,?p,?o[,?g]}`. Cross-source composition uses `SERVICE` clauses inside the query, not multiple `from:` refs.

**Anonymous view**:
A view synthesized at command time from `--query`/`--query-file` (or per-side `--left-query`/`--right-query` on `diff`) on `hash` or `diff`; never cached. In `diff`, an anonymous view's query may project an arbitrary SELECT tuple, which selects **tabular diff** over **graph diff**; declared views and `hash` retain the triple-only restriction.

**Upstream**:
The single source a view references via `from:`. May be a glob, file, endpoint, empty, or another view (in which case resolution recurses). A **File source** is a valid upstream just like the meta **Glob source** it was split from.

**Materialized resolution**:
Loading the upstream into a local in-memory `Store`, then executing the view query against that Store. The default for glob, empty, and view upstreams.
_Avoid_: "in-memory mode", "fetch-then-query"

**Pass-through resolution**:
Forwarding the user's query to the upstream endpoint so the endpoint executes it and returns only the result. Used by `query` when its target is an endpoint, and by views whose `from:` is an endpoint ref.
_Avoid_: "pushdown", "federation"

**Source registry**:
The set of declared sources a command sees, derived from the config file (and/or a single inline positional). A command runs against exactly one of them — the **target source** — except `serve`, which operates on the whole registry.

**Target source**:
The single source a command (`query`, `hash`, `diff`) runs against. Selected by precedence: (1) explicit positional/flag — an `@id` ref or inline glob/URL — wins; (2) the entry marked `default: true`; (3) the sole entry of a one-source registry. `kind: 'reference'` is rejected as a target.
_Avoid_: "selected source", "active source"

**Default source**:
The registry entry marked `default: true`; at most one per registry. In single-target commands it is the **target source** when no positional/flag is given. In `serve` it is the source the web UI pre-selects and the unparameterized `/api/sparql` route forwards to; a one-source **served registry** treats its sole entry as the default even without the marker.

**Served registry** (`serve`):
The set of sources `serve` exposes. By default every non-`reference` source in the **source registry**; `--source` narrows it (an `@id` ref scopes to that entry; an inline glob/URL synthesizes a single `@default` entry). Sources reached only through `from:` chains stay resolvable but are not themselves served. **Materialized** sources resolve eagerly at boot; **pass-through** sources are lazy.
_Avoid_: "registry mode", "single-source mode"

**Result cache**:
The view cache's content. Stores the *result* of a view's query (bounded by the query's projection), not its upstream. Keyed on `view.id + from + query + upstream-spec`. Strategies: `ttl`, `freshness`, `everlasting`.
_Avoid_: "upstream cache", "endpoint cache"

**Freshness probe**:
An `ASK` query attached to `cache.strategy: 'freshness'`, run on cache lookup to decide whether the cached result is still valid.

**Canonicalization**:
RDFC-1.0 normalization producing a stable N-Quads serialization, used by `hash` and `diff` in **graph-diff** mode. **Source records** and other RDF-star annotation triples are stripped before canonical output.

**Graph diff**:
The default `diff` mode, taken when both sides' queries produce triples (`CONSTRUCT` or `SELECT-{?s,?p,?o[,?g]}`). Canonicalizes each side via RDFC-1.0 and set-differences the canonical N-Quads.

**Tabular diff**:
The `diff` mode taken when both sides' queries are arbitrary SELECTs projecting the same set of variable names. Bag-differences the result rows under lexical term equality; per distinct row the diff carries a `count` of net occurrences. Mode is auto-detected from the queries; mixed-shape pairs are rejected. **Source records** do not apply. Blank nodes in the projection are rejected.
_Avoid_: "bindings diff", "result-set diff", "row diff"

**Source transformation pipeline**:
An ordered list of declared transforms attached to a **Glob source** under `transforms:`, applied to its loaded Store before it is handed to any consumer. The registry of available transform keys is closed (only sparqly-known transforms). When a glob is a **split glob**, each synthesized **File source** child inherits a full copy of the pipeline — children behave identically whether targeted directly or through the meta.
_Avoid_: "post-processors", "loader plugins"

**Graph-name transformation** (`graphName`):
A transform whose value is one of `preserve`, `fillDefault`, `forceAll`, `flatten`; the canonical home of graph-name semantics on a glob source.

**Annotate-source transformation** (`annotateSource`):
A transform that emits a **Source record** as an RDF-star annotation on each asserted triple loaded from disk, recording where that triple was authored.

**Auto source annotation**:
The `diff` command's implicit injection of an `annotateSource` step at the head of every glob target's transform pipeline, applied only in **graph-diff** mode. Suppressed by `--skip-auto-source-annotation`. An explicit `annotateSource` in config wins over the implicit injection, preserving its predicate IRIs.
_Avoid_: "annotate-by-default", "implicit annotate"

**Source record**:
A blank-node record reached via `sparqly:source` from an RDF-star quoted triple, with `sparqly:file` (the absolute `file://` IRI of the source file) and optionally `sparqly:line` (1-based line). One record per (file, line) instance of a triple; a triple loaded from two files produces two records under the same quoted-triple subject.
_Avoid_: "provenance triple", "lineage record"

**Diff totals**:
The per-side magnitudes carried alongside every `diff` result. In **graph diff**, totals count each side's **post-strip asserted** quads — the canonical N-Quads set the diff is computed over — so `left - common = removed` and `right - common = added` are arithmetic identities. In **tabular diff**, totals count each side's **total occurrences** (sum of bag multiplicities), not distinct rows.
_Avoid_: "row count", "store size"

**Source-file snippet**:
A span of snippet context lines covering a **Source record**'s focal line range, read from the source file at HTML diff render time. Window size set by `--snippet-context K` on `diff`. Rendered only by the `html` diff format.
_Avoid_: "context window", "hunk preview", bare "context lines"

**Entity hunk**:
The unit a **graph diff** is grouped into for the `html` format and the webapp diff page: all changed quads that resolve to one **anchor** — a named entity's IRI, or, for a changed blank-node tree with no named-entity parent on either side, the orphan tree's root canonical bnode label (an **orphan hunk**). A hunk has a `state` of `changed` / `removed` / `added` according to whether its anchor is present on both sides / only the left / only the right.
_Avoid_: "diff block", "section"

**Describe**:
A sparqly-defined algorithm that computes a symmetric concise bounded description of a seed IRI, capped by a per-source quad limit. Materialized sources expand at every blank node in either position to a fixpoint; endpoint sources fetch depth-0 only, with deeper expansion driven by **describe expansion paths**. Does not traverse to other named IRIs — named-IRI fanout is a UI click-through concern. RDF-star annotations are included only when their quoted triple is already in the result. Distinct from SPARQL's `DESCRIBE` verb, whose semantics are implementation-defined.
_Avoid_: "CBD", conflating with SPARQL `DESCRIBE`, "expand entity"

**Describe expansion path** (`expandedPaths`):
A path from a describe seed IRI to a dangling blank node, sent on a describe request to pull that node one blank-node hop deeper against an `endpoint` source. Path length is capped (~12 steps); past the cap the source is flagged `truncated`. Materialized sources ignore the field — they are already fully expanded. Pinning happens by predicate (blank nodes have no portable identity over the wire), so expanding one of several siblings reached by the same predicate co-expands the siblings.
_Avoid_: "depth parameter", conflating with the **describe-this affordance**

**Describe page**:
The webapp surface that runs **describe** of a seed IRI across one or more sources in the **served registry** and renders the merged result. Initial state on first load selects all sources; zero sources selected produces an empty result with a "Select all" affordance. The default view renders the merged quads as two **describe sections**.

**Describe section**:
One of the two halves the **Describe page**'s default view splits the merged quads into: **outbound** (quads whose subject is the seed) and **inbound** (quads whose object is the seed). Within a section, quads are grouped by predicate, with named IRIs rendered as **describe-this affordance** chips, literals inline, and blank nodes inlined as nested blocks showing their own predicate-grouped properties.
_Avoid_: "outgoing"/"incoming", a separate "blank nodes" section

**Describe-this affordance**:
A click-through control rendered next to every named IRI in the webapp's structured RDF renderers (query results, diff cells, **describe sections**); activating it opens a new describe page on the fully-expanded IRI. Attaches to named IRIs only — never to blank nodes, literals, or graph names.
_Avoid_: "auto-expand"

**Describe provenance**:
A sparqly-injected RDF-star annotation recording per-quad *registry membership* — which source `@id` returned the quad. Subject is the quoted quad; object is the source `@id` as an `xsd:string` literal. The webapp renderer strips these annotations on receipt and surfaces source membership as per-quad UI badges, leaving user-authored RDF-star visible. Distinct from **Source records**, which record *file authorship* (file + line).
_Avoid_: conflating with **Source records**, "from-graph annotation"

**Describe bnode rewrite**:
A deterministic per-source bnode-label rewrite applied at describe merge time: every bnode label `_:x` returned from source `foo` is rewritten to `_:foo__x` before quads enter the merged set, giving every source a disjoint bnode label space so post-merge lexical dedup cannot conflate document-scoped blank nodes from different sources.
_Avoid_: "bnode canonicalization"

**Describe response counts**:
The `count` value reported per source on a describe response is **post-dedup membership** — the number of merged quads whose badge set includes this source, not the raw count the source returned before merge. The sum of per-source counts exceeds the merged total whenever any IRI-only quad was returned from more than one source.

**Describe block**:
The top-level `describe:` block in the project config, carrying registry-wide describe defaults: a soft per-source quad cap applied when a request omits one, a hard ceiling a request-supplied cap cannot exceed, and an override for the **describe provenance** predicate. Per-source truncation surfaces as `truncated: true` on the source's response entry.

**Context block**:
The top-level `context:` block in the project config, carrying registry-wide IRI display config: `{ prefixes: Record<string, string>, base?: string }`. The effective renderer prefix map is `DEFAULT_PREFIXES` (rdf, rdfs, owl, xsd) ∪ `context.prefixes` with config winning on conflicts; `context.base` is a strict-fallback short-form for IRIs no prefix matches. Config-only — there are no per-command CLI overrides.
_Avoid_: "format block", "display config", "prefix block"

## Relationships

- A **View** has exactly one **Upstream** source via `from:`.
- An **Upstream** is itself a **Source** (glob, endpoint, empty, or view; reference is rejected).
- A **View** whose `from:` is an **Endpoint source** resolves via **pass-through**; glob, empty, and view upstreams resolve via **materialized**.
- A **View** with `cache:` declared writes to the **Result cache** after resolution; `cache.strategy: 'freshness'` triggers a **Freshness probe** on lookup.
- **`query`** picks one **target source** from the **source registry** and resolves it: **pass-through** when the target is an endpoint, **materialized** otherwise.
- **`serve`** exposes the **served registry**; resolution per source follows the same rules as `query`.
- **`hash`** picks one **target source** and always **canonicalizes** the resolved Store; it refuses raw endpoints (must be wrapped in a view) and refuses arbitrary-SELECT views.
- **`diff`** picks one **target source** per side and dispatches by query shape: **graph diff** when both sides produce triples; **tabular diff** when both sides project arbitrary SELECT tuples with matching variable names. Mixed-shape pairs are rejected. Both modes refuse a raw endpoint as target.
- A **Glob source** may declare a **Source transformation pipeline**; transforms run in array order at load time before the Store is exposed to resolution. A **split glob**'s synthesized **File source** children inherit the pipeline.
- A **split glob** is targetable as the union (`@meta`) and as any of its children (`@meta/<relative-path>`); a child may serve as a CLI target, an `@id` in `view.from:`, or a selection in the webapp picker. The single-target rule (ADR-0005) is preserved — both the meta and any one child are single targets; the picker remains single-select on `query`/`hash`/`diff`.
- The **Annotate-source transformation** populates **Source records** on the glob's own asserted triples; annotations do not propagate through a downstream **View** unless that view's query explicitly references them, and they are stripped by **Canonicalization**.
- `diff` injects **Auto source annotation** by default for any glob target in **graph-diff** mode; an explicit `annotateSource` declaration in config takes precedence.
- `diff` (in **graph-diff** mode) extracts **Source records** per side after **Canonicalization** and surfaces them across every graph output format; the `html` format additionally renders a **Source-file snippet** per record.
- Every command that renders IRIs reads from the **Context block** under one rule: prefix map = `DEFAULT_PREFIXES` ∪ `context.prefixes` (config wins); base = `context.base` as strict fallback after prefix match.
- The **Describe page** runs **describe** against the registry, which dispatches per source kind: `glob`/`view` targets materialize and run the full describe fixpoint; `endpoint` targets fetch depth-0 only, with deeper expansion driven by **describe expansion paths**; `empty` is rejected as a top-level describe target; `reference` is rejected. Per-source caps come from the **Describe block**.
- A describe request is best-effort multi-origin: one source failing does not fail the request. **Describe provenance** annotations are stripped by the webapp renderer and surfaced as UI badges; they never conflate with user-authored RDF-star or with **Source records**.

## Example dialogue

> **Dev:** "We're hashing a 50M-triple **endpoint** with `--query` to scope to a tiny subset, but the process OOMs."
> **Maintainer:** "It was resolving as **materialized** — pulling the whole endpoint into a local Store before applying the query. Single-endpoint **anonymous views** now use **pass-through**, so your query reaches the endpoint and only the result comes back."
> **Dev:** "Will the **result cache** save the next run?"
> **Maintainer:** "Yes — the cache stores the query's *result*, not the upstream. Either resolution path produces the same cached entry, keyed on the same fields."

## Flagged ambiguities

- **"Materialize"** had been used to mean both "load upstream into a Store" and "produce the final result"; resolved — **materialized** refers only to the upstream-loading resolution path. A view's output is "produced" or "computed", never "materialized".
- **"Cache the upstream"** confused users who expected the cache to grow with endpoint size; resolved — the **result cache** stores the view's *output*, bounded by the view query.
- **"Pushdown"** appeared informally as a synonym for **pass-through**; resolved — the canonical term is **pass-through**.
- **"`annotate` transform"** (legacy name) was renamed to **`annotateSource`** to disambiguate from a hypothetical future "annotate by inference" or "annotate by SHACL"; resolved — only `annotateSource` parses.
- **"context"** carried two meanings: snippet context lines on `diff`'s `html` output, and JSON-LD-style display config (prefix map + base). Resolved — the snippet flag is `--snippet-context K` and the **Source-file snippet** definition speaks of "snippet context lines"; the unqualified noun **context** refers only to the **Context block**.
