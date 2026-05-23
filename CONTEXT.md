# sparqly

A CLI for querying, hashing, diffing, formatting, and serving RDF, built around declarative source specs that compose globs of files, remote SPARQL endpoints, and views that scope upstreams via SPARQL queries.

## Language

### Sources

**Source**:
A declared input that produces RDF. One of glob, file, endpoint, empty, view, or reference; file sources are never user-declared and exist only as children of a **split glob**.

**Glob source**:
A **Source** that matches RDF files on disk via a glob pattern; an empty match yields an empty store with a warning, not an error.

**File source**:
A **Source** addressing exactly one RDF file, synthesized as the child of a **split glob** when that glob is loaded and linked back to it. Never user-declared.
_Avoid_: "single-file glob", "leaf source"

**Split glob**:
A **Glob source** that additionally exposes one **File source** per matched file as a peer registry entry, while the meta retains union-of-files semantics. Child ids are stable across enumeration order and across files entering or leaving the match set.
_Avoid_: "exploded glob", "fan-out glob"

**Disk-backed glob**:
A **Glob source** whose **Materialized resolution** loads its matched files into a persistent on-disk **Glob index** rather than an in-memory store, so a glob whose triples exceed RAM stays queryable.
_Avoid_: "indexed glob", "big glob", "external source", conflating with **Endpoint source**

**Endpoint source**:
A **Source** whose value is the URL of a remote SPARQL HTTP endpoint.

**Empty source**:
A **Source** that produces no triples of its own, intended to host a view whose query composes data via `SERVICE` clauses across endpoints that do not themselves support `SERVICE`.

**View**:
A **Source** that scopes exactly one **Upstream** with a SPARQL query, whose shape must be `CONSTRUCT` or a triple-shaped `SELECT`. Cross-source composition is expressed with `SERVICE` clauses inside the query, not multiple upstreams.

**Anonymous view**:
A **View** synthesized at command time from an inline query on `hash` or `diff`; never persisted to the registry and never cached. On `diff`, an anonymous view may project an arbitrary `SELECT` tuple, which selects **tabular diff** over **graph diff**.

**Upstream**:
The single **Source** a **View** references. May be any source kind except a reference — including a **File source** child of a **Split glob**.

### Registries & targets

**Source registry**:
The set of declared **Sources** a command sees, derived from the project config and any inline positional. A command runs against exactly one of them — the **target source** — except `serve`, which operates on the whole registry.

**Target source**:
The single **Source** a `query`, `hash`, or `diff` command runs against, selected by an explicit reference, then the registry's **default source**, then sole membership. A reference source is rejected.
_Avoid_: "selected source", "active source"

**Default source**:
The single registry entry flagged as the implicit target when no source is named — the **target source** for single-target commands and the pre-selected entry for `serve`. At most one per registry.

**Served registry** (`serve`):
The subset of the **source registry** that `serve` exposes; by default every non-reference source. Sources reached only through a **View**'s upstream chain remain resolvable but are not themselves served.
_Avoid_: "registry mode", "single-source mode"

### Resolution

**Materialized resolution**:
The resolution path that loads a **Source**'s upstream into a local store and runs the view query against that store; the default for glob, empty, and view upstreams.
_Avoid_: "in-memory mode", "fetch-then-query"

**Pass-through resolution**:
The resolution path that forwards the user's query to a remote endpoint so the endpoint executes it and returns only the result; the only path used when the target is an **Endpoint source**.
_Avoid_: "pushdown", "federation"

**Lazy materialization** (`serve`):
The contract that a **Served registry** entry's store is built only on the first request that touches it, then memoized for the life of the process. Speaks to _when_ the store is built, not _how_.
_Avoid_: "lazy loading", "on-demand resolution", "deferred boot"

**Glob index**:
The persistent on-disk quad store a **Disk-backed glob** materializes into. Carries a manifest of the matched files, the sparqly version, and the applied transforms, so a stale build surfaces explicitly rather than as a silent rebuild.
_Avoid_: "cache", "database", "snapshot", "derived cache"

### Pinning

**Pinned source**:
A **Glob source** resolved against a specific git revision rather than the working tree; synthesized at resolution time and never a registry entry.
_Avoid_: "ad-hoc source", "snapshot source", "git-pinned source"

**Pinned ref**:
A git revision pointing at an immutable commit — a full SHA or annotated tag — so a **Pinned source** built from it is reproducible across fetches.
_Avoid_: "frozen ref", "fixed ref"

**Floating ref**:
A git revision pointing at a moving target — a branch, `HEAD`, `HEAD~n`, or a lightweight tag — so a **Pinned source** built from it is current at fetch time but not reproducible across fetches.
_Avoid_: "live ref", "mutable ref"

### Transforms & provenance

**Source transformation pipeline**:
An ordered list of declared transforms attached to a **Glob source**, applied to its loaded store before any consumer sees it. The set of available transforms is closed.
_Avoid_: "post-processors", "loader plugins"

**Graph-name transformation**:
The canonical home of graph-name semantics on a **Glob source**, with modes that preserve, fill, force, or flatten the graph name of every loaded quad.

**Union default graph**:
A non-destructive query-time option on a **Glob source** that makes SPARQL against its store treat the default graph as the union of every graph; named graphs remain addressable and the store itself is unchanged.
_Avoid_: "graph merge", conflating with the destructive `flatten` **Graph-name transformation** mode

**Annotate-source transformation**:
An explicit-opt-in transform on a **Glob source** that projects each triple's **Source record** into the loaded store as RDF-star, so consumers can pattern-match against provenance directly in SPARQL.

**Source record**:
The in-memory provenance record for one asserted triple loaded from a **Glob source** or **File source**, carrying file, line, optional end-line, and an optional git ref and resolved SHA for triples loaded from a **Pinned source**.
_Avoid_: "provenance triple", "lineage record"

**Source record sidecar**:
The per-source mapping from each asserted triple to its **Source records**, produced by the loader and carried alongside the loaded store through resolution. Independent of any RDF-star projection of the same records into the store.
_Avoid_: "annotation sidecar", "provenance map"

### Caching

**Result cache**:
The store of a **View**'s query _result_, bounded by the query's projection rather than the size of the upstream.
_Avoid_: "upstream cache", "endpoint cache"

### Canonicalization & diff

**Canonicalization**:
The RDFC-1.0 normalization sparqly uses to produce a stable N-Quads form, the basis of `hash` and **graph diff**. RDF-star annotation triples — including **Source records** projected into the store — are stripped before canonical output.

**Graph diff**:
The `diff` mode in which both sides are canonicalized and set-differenced as N-Quads; the default when both sides produce triples.

**Tabular diff**:
The `diff` mode in which both sides are arbitrary `SELECT`s projecting matching variable names and their result rows are bag-differenced under lexical term equality, carrying a per-row net occurrence count. **Source records** do not apply.
_Avoid_: "bindings diff", "result-set diff", "row diff"

**Source-file snippet**:
A window of context lines around one or more contributing **Source records**, read from the source file at HTML render time; adjacent records' windows merge into one box with each record's focal range highlighted independently.
_Avoid_: "context window", "hunk preview", bare "context lines"

**Entity hunk**:
The unit a **graph diff** is grouped into for HTML output: every changed quad that resolves to one anchor — a named entity's IRI, or, when none exists on either side, the orphan blank-node tree's canonical root.
_Avoid_: "diff block", "section"

### Describe

**Describe**:
A sparqly-defined algorithm that returns a symmetric concise bounded description of a seed IRI, capped per source. Distinct from SPARQL's `DESCRIBE` verb, whose semantics are implementation-defined.
_Avoid_: "CBD", conflating with SPARQL `DESCRIBE`, "expand entity"

**Describe expansion path**:
A path from a describe seed IRI to a dangling blank node, sent on a follow-up describe request to pull that node one blank-node hop deeper. Valid only against an **Endpoint source**.
_Avoid_: "depth parameter", conflating with the **describe-this affordance**

**Describe page**:
The webapp surface that runs **describe** against the **served registry** and renders the merged result, exposing a single-or-cleared source picker that scopes the describe to one source or to every served source.

**Describe section**:
One of the two halves the **Describe page** splits the merged quads into — **outbound** (the seed is the subject) and **inbound** (the seed is the object).
_Avoid_: "outgoing"/"incoming", a separate "blank nodes" section

**Describe-this affordance**:
A click-through control rendered next to every named IRI in the webapp's structured RDF renderers that opens a new **Describe page** on the fully-expanded IRI. Attaches to named IRIs only.
_Avoid_: "auto-expand"

**Describe provenance**:
A sparqly-injected RDF-star annotation recording per-quad **served registry** membership — which source returned the quad. Distinct from **Source records**, which record file authorship.
_Avoid_: conflating with **Source records**, "from-graph annotation"

### Saved queries

**Saved query**:
A named SPARQL query persisted in the **Saved-query sidecar** as webapp-scoped state. Not a **Source** — never in the **source registry**, never `@id`-resolvable, never an **Upstream**; the durable, source-bound, config-declared counterpart is a **View**.
_Avoid_: "snippet", "bookmark", conflating with **View**

**Saved-query authoring surface**:
The webapp's queries page — the single surface on which **Saved query** entries are created, edited, parameter-declared, renamed, and deleted. Collapses to browse-and-run under `serve --read-only`.
_Avoid_: "queries library page", "saved-query manager"

**Saved-query run surface**:
A webapp surface that consumes **Saved query** entries without authoring them — today, the `query` page and each side of the `diff` page. Exposes Load and the runtime parameter form only, never Save, Save-as, Delete, or parameter authoring.
_Avoid_: "read-only editor", "query playground", conflating with **Saved-query authoring surface**

**Templated saved query**:
A **Saved query** with a non-empty **Parameter declaration** list; at run time the supplied values are composed into a `VALUES` clause prepended to the body. The template body itself is always valid SPARQL — there is no text-level placeholder syntax.
_Avoid_: "parameterized query", "query template", conflating "template" with a separate artifact kind

**Parameter declaration**:
One declared input on a **Templated saved query**, carrying its variable name, RDF datatype, cardinality (lower bound 0 or 1, upper bound 1 or many), and form-presentation fields. The single source of truth from which the form, the binding validator, and the substitution algorithm are driven.
_Avoid_: "input", "form field", "argument", separate "required" flag

**Saved-query sidecar**:
A YAML file alongside the project config that holds the **Saved query** library; dual-authored by the webapp and by hand, with hand-edits round-tripping cleanly. The only project-file mutation surface exposed by `serve`.
_Avoid_: "queries file", "saved-query store", "library file"

### Serve UI

**Source load state**:
The state of a **served registry** entry as exposed by `serve`, with one state machine per materialization mode: in-memory materialized entries pass through loading/loaded/failed, **Disk-backed glob** entries through indexing/ready/failed plus `stale` for a mismatched manifest, and **Endpoint sources** pass through unconditionally.
_Avoid_: "source status", a unified "idle/busy/ready" taxonomy

**Sources page**:
The webapp surface that lists every **served registry** entry with its **Source load state** and exposes per-entry admin triggers — Load, Reload, Unload, (Re)build index, Test connection — each gated by `serve --read-only`. Read-only against the registry itself: the page never declares new sources.
_Avoid_: "sources dashboard", "registry page"

## Relationships

- A **View** has exactly one **Upstream** source via `from:`.
- An **Upstream** is itself a **Source** (glob, endpoint, empty, or view; reference is rejected).
- A **View** whose `from:` is an **Endpoint source** resolves via **pass-through**; glob, empty, and view upstreams resolve via **materialized**.
- A **View** with `cache:` declared writes to the **Result cache** after resolution.
- **`query`** picks one **target source** from the **source registry** and resolves it: **pass-through** when the target is an endpoint, **materialized** otherwise.
- **`serve`** exposes the **served registry**; resolution per source follows the same rules as `query`.
- **`hash`** picks one **target source** and always **canonicalizes** the resolved Store; it refuses raw endpoints (must be wrapped in a view) and refuses arbitrary-SELECT views.
- **`diff`** picks one **target source** per side and dispatches by query shape: **graph diff** when both sides produce triples; **tabular diff** when both sides project arbitrary SELECT tuples with matching variable names. Mixed-shape pairs are rejected. Both modes refuse a raw endpoint as target.
- A **Disk-backed glob** rejects the **Annotate-source transformation** (the **Glob index** cannot persist RDF-star quoted triples), carries no **Source record sidecar**, and is rejected by `hash` and `diff` (canonicalization needs every quad in memory). A declared **Graph-name transformation** mode is baked into the **Glob index** at build time.
- The disk-backed storage selector is valid only on glob and file sources; a **Split glob**'s synthesized **File source** children inherit it and are indexed independently of the meta and of each other.
- A **Pinned source** is a **Glob source** resolved against a git revision; the glob's transform pipeline applies unchanged, and when the glob is also a **Split glob**, the meta enumerates files from the git tree at the resolved SHA (not the working tree). Synthesized **File source** children inherit the pin alongside the transform pipeline.
- A **Pinned source**'s **Result cache** keys on the resolved SHA, never the user-facing ref string. A **Pinned ref** is reproducible across fetches; a **Floating ref** is not, and the resolved SHA is what surfaces in any source records or diff reports.
- Pinning a **View** target (e.g. `@my-view:v1.2`) leaves the view's query unchanged and propagates the ref down the `from:` chain until it reaches a glob (recursing through intermediate views). Reaching an endpoint or empty source on the way down is a hard error reported at expand time. Cross-source `SERVICE` clauses inside the query are not affected — they reference endpoints by URL, not by `from:`, and remain unpinned.
- A **Glob source** may declare a **Source transformation pipeline**; transforms run in array order at load time before the Store is exposed to resolution. A **Split glob**'s synthesized **File source** children inherit the pipeline.
- A **Glob source**'s **Union default graph** setting is applied as a query-context option at every SPARQL execution against its materialized Store — including a **View**'s own query when `from:` resolves to that glob — but never propagated to a view's output Store. It is orthogonal to the **Graph-name transformation**: `flatten` destructively drops graph names, whereas **Union default graph** is a non-destructive query-time option that leaves named graphs addressable.
- A **Split glob** is targetable as the union (`@meta`) and as any of its children (`@meta/<relative-path>`); a child may serve as a CLI target, an `@id` in `view.from:`, or a selection in the webapp picker. The single-target rule is preserved — both the meta and any one child are single targets; the picker remains single-select on `query`/`hash`/`diff`.
- The **Annotate-source transformation** projects **Source records** as RDF-star into the glob's loaded Store for SPARQL queryability; the projection does not propagate through a downstream **View** unless that view's query explicitly references it, and it is stripped by **Canonicalization**. The projection is independent of the **Source record sidecar** that `diff` consumes.
- `diff` (in **graph-diff** mode) consumes the per-side **Source record sidecar** carried by every glob/file target; explicit **Annotate-source transformations** in the user's config emit RDF-star into the Store independently and do not feed diff. Source records are surfaced across every graph output format; the `html` format additionally renders a **Source-file snippet** per record.
- Every command that renders IRIs reads the project-config `context:` block under one rule: prefix map = built-in defaults ∪ `context.prefixes` (config wins); base = `context.base` as strict fallback after prefix match.
- The **Describe page** runs **describe** against the registry, which dispatches per source kind: `glob`/`view` targets materialize and run the full describe fixpoint; `endpoint` targets fetch depth-0 only, with deeper expansion driven by **describe expansion paths**; `empty` is rejected as a top-level describe target; `reference` is rejected.
- A describe request is best-effort multi-origin: one source failing does not fail the request. **Describe provenance** annotations are stripped by the webapp renderer and surfaced as UI badges; they never conflate with user-authored RDF-star or with **Source records**.
- A **Saved query** is webapp-scoped state: it is _not_ a **Source**, never appears in the **source registry**, never resolvable via `@id`, and never reachable through `from:`. The durable, source-bound, config-declared counterpart is a **View**. A **Templated saved query** carries a `parameters:` list (one entry per **Parameter declaration**); at run time the webapp builds a `VALUES` clause from the user-supplied values and prepends it to the body via client-side substitution, then runs the substituted SPARQL through the server as ordinary query — `serve` does not learn about templates.
- Reading and writing the **Saved-query sidecar** is the **only** path by which `serve` mutates project files. Writes use optimistic concurrency, so concurrent edits from two browsers surface as visible conflicts rather than silent data loss. Under `serve --read-only`, the library is loadable but immutable, and the **Sources page**'s per-entry admin triggers are likewise refused.
- The webapp deep-links **Saved query** loads via a URL slug parameter plus per-parameter binding keys (multi-cardinality values supplied as repeated keys). This is mutually exclusive with the inline-SPARQL URL form — editing a loaded saved-query body on a **Saved-query run surface** transitions the URL to the inline form. Persisting the edit requires opening the slug on the **Saved-query authoring surface**; run surfaces carry no Save, Save-as, or "modified from `<slug>`" affordance.
- Loading a **Saved query** is source-agnostic: the user's currently-selected source is untouched, and the artifact persists no `lastUsedSource` or `intendedSource` field. A user who wants a query durably bound to a specific source declares a **View** instead — the same axis along which a **Saved query** and a **View** already differ (transient/UI vs. durable/config) extends to source binding.
- The **Saved-query authoring surface** is the single write surface for the **Saved-query sidecar**; the **Saved-query run surfaces** are read-only against it. `serve --read-only` collapses the authoring surface to browse-and-run without changing the run surfaces (which never write to begin with).

## Example dialogue

> **Dev:** "We're hashing a 50M-triple **endpoint** with `--query` to scope to a tiny subset, but the process OOMs."
> **Maintainer:** "It was resolving as **materialized** — pulling the whole endpoint into a local Store before applying the query. Single-endpoint **anonymous views** now use **pass-through**, so your query reaches the endpoint and only the result comes back."
> **Dev:** "Will the **result cache** save the next run?"
> **Maintainer:** "Yes — the cache stores the query's _result_, not the upstream. Either resolution path produces the same cached entry, keyed on the same fields."

## Flagged ambiguities

- **"Materialize"** had been used to mean both "load upstream into a Store" and "produce the final result"; resolved — **materialized** refers only to the upstream-loading resolution path. A view's output is "produced" or "computed", never "materialized".
- **"Cache the upstream"** confused users who expected the cache to grow with endpoint size; resolved — the **result cache** stores the view's _output_, bounded by the view query.
- **"Pushdown"** appeared informally as a synonym for **pass-through**; resolved — the canonical term is **pass-through**.
- **"`annotate` transform"** (legacy name) was renamed to **`annotateSource`** to disambiguate from a hypothetical future "annotate by inference" or "annotate by SHACL"; resolved — only `annotateSource` parses.
- **"Source record"** had been defined as the RDF-star blank-node structure emitted by the `annotateSource` transform, but the diff command (which never wrote SPARQL queries against it) was the only first-class consumer. Resolved — the canonical referent is the in-memory `{file, line, …}` struct carried as a **Source record sidecar** by the loader; the RDF-star form is now described as a _projection_ authored by the **Annotate-source transformation** for SPARQL queryability and is independent of the sidecar.
- **"context"** carried two meanings: snippet context lines on `diff`'s `html` output, and JSON-LD-style display config (prefix map + base). Resolved — the snippet flag is `--snippet-context K` and the **Source-file snippet** definition speaks of "snippet context lines"; the unqualified noun **context** refers only to the project-config `context:` block (display config: prefix map + base).
