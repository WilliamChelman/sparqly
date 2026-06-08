# sparqly

A CLI for querying, hashing, diffing, formatting, and serving RDF, built around declarative source specs over globs of files, remote SPARQL endpoints, and on-disk indexes. Derivation is expressed as an inline query at command time, never as a persisted source.

## Language

### Sources

**Source**:
A declared input that produces RDF. One of glob, file, endpoint, empty, or reference; file sources are never user-declared and exist only as children of a **split glob**. There is no derived source — derivation is an **inline query** at command time, never a persisted source.

**Glob source**:
A **Source** that matches RDF files on disk via a glob pattern; an empty match yields an empty store with a warning, not an error.

**File source**:
A **Source** addressing exactly one RDF file, synthesized as the child of a **split glob** when that glob is loaded and linked back to it. Never user-declared.
_Avoid_: "single-file glob", "leaf source"

**Split glob**:
A **Glob source** that additionally exposes one **File source** per matched file as a peer registry entry, while the meta retains union-of-files semantics. Child ids are stable across enumeration order and across files entering or leaving the match set.
_Avoid_: "exploded glob", "fan-out glob"

**Disk-backed glob**:
A **Glob source** whose matched files are loaded into a persistent on-disk **Glob index** rather than an in-memory store, so a glob whose triples exceed RAM stays queryable. Resolves via **pass-through** — queries run against the **Glob index** directly and only the result is materialized, mirroring the **Endpoint source** contract.
_Avoid_: "indexed glob", "big glob", "external source", conflating with **Endpoint source**

**Endpoint source**:
A **Source** whose value is the URL of a remote SPARQL HTTP endpoint.

**Empty source**:
A **Source** that produces no triples of its own, used as a neutral target for an **inline query** that composes data via `SERVICE` clauses across endpoints that do not themselves support `SERVICE`. Earmarked to become a writable on-disk store in a future slice.

**Triple-shaped SELECT**:
A `SELECT` query whose projection is exactly `?s ?p ?o` or `?s ?p ?o ?g` (position-independent). A valid query shape for an **Inline query** that must produce triples, and for the `query` command when an RDF output format is explicitly requested — in the latter case the result rows are reified as triples or quads for serialization. Rows with an unbound `?g` are promoted to the default graph rather than dropped.
_Avoid_: "SPO query", "graph-shaped SELECT", "triple SELECT"

**Inline query**:
A SPARQL query passed directly to `query`, `hash`, or `diff` and run against the **target source** — the only derivation sparqly performs, since there is no derived **Source**. On `diff`, an arbitrary `SELECT` tuple selects **tabular diff** over **graph diff**; `hash` and graph-`diff` require a query that produces triples (`CONSTRUCT` or a **triple-shaped SELECT**). Never persisted, never `@id`-addressable.
_Avoid_: "anonymous view", "ad-hoc view", "view"

**Playground**:
The webapp's home surface for composing and running an **inline query** against a single selected source; it is also a **Saved-query run surface**. "Playground" is this page's UI and nav label — the canonical user-facing name for what is described elsewhere as the "query page".
_Avoid_: extending "Playground" to the other **Saved-query run surfaces** (e.g. the `diff` page's loaders); "query playground" as a synonym for the run-surface concept itself.

### Registries & targets

**Source registry**:
The set of declared **Sources** a command sees, derived from the project config and any inline positional. A command runs against exactly one of them — the **target source** — except `serve`, which operates on the whole registry.

**Target source**:
The single **Source** a `query`, `hash`, or `diff` command runs against, selected by an explicit reference, then the registry's **default source**, then sole membership. A reference source is rejected.
_Avoid_: "selected source", "active source"

**Default source**:
The single registry entry flagged as the implicit target when no source is named — the **target source** for single-target commands and the pre-selected entry for `serve`. At most one per registry.

**Served registry** (`serve`):
The subset of the **source registry** that `serve` exposes; by default every non-reference source.
_Avoid_: "registry mode", "single-source mode"

### Resolution

**Materialized resolution**:
The resolution path that loads a **Source** into a local in-memory store and runs the command's **inline query** against it; the default for in-memory glob and **File source** targets.
_Avoid_: "in-memory mode", "fetch-then-query"

**Pass-through resolution**:
The resolution path that runs the user's query against the source's own store — a remote SPARQL endpoint or a local **Glob index** — and materializes only the result. Used for **Endpoint sources** and **Disk-backed globs**.
_Avoid_: "pushdown", "federation"

**Lazy materialization** (`serve`):
The contract that a **Served registry** entry's store is built only on the first request that touches it, then held resident under a per-worker LRU budget (`query.maxResidentQuads`) rather than for the life of the process (ADR-0050 amends ADR-0031). The store for an in-memory entry is built and owned by the **query worker**, off the main event loop; the main thread keeps only a state mirror. When a build pushes a worker over budget it evicts its least-recently-used idle store (a store with an in-flight query is pinned); a later query for an evicted source rebuilds it transparently on the same sticky worker. Speaks to _when_ the store is built, not _how_.
_Avoid_: "lazy loading", "on-demand resolution", "deferred boot"

**Glob index**:
The persistent on-disk quad store a **Disk-backed glob** materializes into. Carries a manifest of the matched files, the sparqly version, and the applied transforms, so a stale build surfaces explicitly rather than as a silent rebuild.
_Avoid_: "cache" (caching results is the **Query cache**; this is a source's own queryable store), "database", "snapshot", "derived cache"

### Query cache

**Query cache**:
An opt-in store of serialized **inline query** results, so a repeated query against the same **target source** is answered without re-running resolution. It sits above every resolution path and is available to every **Source** kind. Distinct from the **Glob index** (a source's own queryable store) and from the resident-set store budget (`query.maxResidentQuads`, which holds loaded Stores, not results): the **Query cache** holds *answers*, the others hold *data*. Enabled per source, never on by default.
_Avoid_: "cache" unqualified (collides with **Glob index**), "result store", "memo", conflating with the resident set

**Cached result**:
One **Query cache** entry: the serialized body of a single (**target source**, query, output format, display **context**) combination, bounded by an explicit freshness contract. For local sources (materialized glob/file, **Disk-backed glob**) the entry is keyed on a content fingerprint, so any underlying change is a different key — a miss — rather than a stale hit; for an **Endpoint source**, whose store is opaque, an elapsed-time bound is the only staleness guard. A **Pinned source** keys on its resolved SHA and so is reproducibly cacheable.
_Avoid_: "snapshot", loose "cache hit"

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
The webapp surface that runs **describe** against exactly one source and renders the result, split into **describe sections**. Exposes a mandatory single-select source picker mirroring the `query` and `diff` pages — it auto-selects the registry's **default source** on landing, falling back to the first listed source when none is marked default, and never offers a cleared or all-sources state. There is no cross-source merging: the page shows only the selected source's description.
_Avoid_: "merged result", "single-or-cleared picker", "describe across the registry", "multi-source aggregation"

**Describe section**:
One of the two halves the **Describe page** splits the describe result into — **outbound** (the seed is the subject) and **inbound** (the seed is the object).
_Avoid_: "outgoing"/"incoming", a separate "blank nodes" section

**Describe-this affordance**:
A click-through control rendered next to every named IRI in the webapp's structured RDF renderers that opens a new **Describe page** on the fully-expanded IRI, scoped to the calling surface's current source when one is set; when none is set, the Describe page falls back to the **default source**. The **tabular diff** surface carries two current sources and renders one affordance per side, collapsed to one when both sides resolve to the same source id. Attaches to named IRIs only.
_Avoid_: "auto-expand"

### Saved queries

**Saved query**:
A named SPARQL query persisted in the **Saved-query sidecar** as webapp-scoped state. Not a **Source** — never in the **source registry**, never `@id`-resolvable. It is the only named query artifact; sparqly has no config-declared query source.
_Avoid_: "snippet", "bookmark"

**Saved-query authoring surface**:
The webapp's queries page — the single surface on which **Saved query** entries are created, edited, parameter-declared, renamed, and deleted. Collapses to browse-and-run under `serve --read-only`.
_Avoid_: "queries library page", "saved-query manager"

**Saved-query run surface**:
A webapp surface that consumes **Saved query** entries without authoring them — today, the `query` page and each side of the `diff` page. Exposes Load and the runtime parameter form only, never Save, Save-as, Delete, or parameter authoring.
_Avoid_: "read-only editor", "query playground" (the **Playground** is one specific host of this surface, not a synonym for it), conflating with **Saved-query authoring surface**

**Templated saved query**:
A **Saved query** with a non-empty **Parameter declaration** list; at run time the supplied values are composed into a `VALUES` clause prepended to the body. The template body itself is always valid SPARQL — there is no text-level placeholder syntax.
_Avoid_: "parameterized query", "query template", conflating "template" with a separate artifact kind

**Parameter declaration**:
One declared input on a **Templated saved query**, carrying its variable name, RDF datatype, cardinality (lower bound 0 or 1, upper bound 1 or many), and form-presentation fields. The single source of truth from which the form, the binding validator, and the substitution algorithm are driven.
_Avoid_: "input", "form field", "argument", separate "required" flag

**Saved-query sidecar**:
A YAML file alongside the project config that holds the **Saved query** library; dual-authored by the webapp and by hand, with hand-edits round-tripping cleanly. The only project-file mutation surface exposed by `serve`.
_Avoid_: "queries file", "saved-query store", "library file"

### Editor presets

**Quick query**:
A hardcoded SPARQL body the webapp's query editor can swap in on demand from a small closed menu (e.g. `select-spo`, `select-spog`, `construct-spo`). Not a **Source**, not a **Saved query**, never persisted, never deep-linkable, never source-bound. Inserted into the active editor buffer alongside the project-config prefixes; from that moment it is just edited text.
_Avoid_: "template", "snippet", "preset query", conflating with **Saved query** or **Templated saved query**

### Serve UI

**Source load state**:
The state of a **served registry** entry as exposed by `serve`, with one state machine per materialization mode: in-memory materialized entries pass through loading/loaded/failed, **Disk-backed glob** entries through indexing/ready/failed plus `stale` for a mismatched manifest, and **Endpoint sources** pass through unconditionally.
_Avoid_: "source status", a unified "idle/busy/ready" taxonomy

**Sources page**:
The webapp surface that lists every **served registry** entry with its **Source load state** and exposes per-entry admin triggers — Load, Reload, Unload, (Re)build index, Test connection — each gated by `serve --read-only`. Read-only against the registry itself: the page never declares new sources.
_Avoid_: "sources dashboard", "registry page"

### Testing

**E2E**:
The cli end-to-end suite under `apps/cli-e2e`, exercised by `pnpm run e2e`. The unqualified term refers to this lane only.
_Avoid_: conflating with **Web e2e**

**Web e2e**:
The webapp end-to-end suite under `apps/web-e2e`, exercised by `pnpm run e2e:web`. Drives a real browser (Playwright) against a real `serve` booted on a fixture project config. Owns the happy-path of every user-visible feature ("clickable → web e2e"). The only test layer that asserts on rendered HTML.
_Avoid_: bare "e2e" (means cli-e2e), "webapp integration test", "ui test"

**DOM-free spec**:
A webapp unit spec that tests the _logic_, not the _rendering_. May use `TestBed`, dependency injection, `HttpTestingController`, and may instantiate a component (e.g. `TestBed.createComponent`) to drive its signals and methods through its public surface. Must not call `fixture.detectChanges()` (or any equivalent that flushes the template), query the rendered DOM, or assert on rendered HTML, classes, or attributes. The canonical home for non-trivial derived state — services, signal-only classes, page/component classes read through their public surface, and pure helpers. If the assertion needs a rendered template, it belongs in **Web e2e**.
_Avoid_: "unit test" (too generic), "logic spec", "headless spec"

**Accessible selector**:
A web-e2e locator chosen by ARIA role, accessible name, label, or visible text — the Playwright / Testing Library default. The required selector style for **Web e2e** and any surviving spec that does touch the DOM.

**Test escape hatch**:
The `data-testid` attribute, allowed only where no **Accessible selector** can disambiguate the target. Each surviving use is justified in code review; the default is to fix the markup (add an `aria-label`, a real `<label>`, a heading) rather than add the attribute.
_Avoid_: "test id" as a default selector, "test hook"

## Relationships

- A **Source** resolves by its own kind — there is no `from:` chain and no derived source. **Inline queries** reshape a target at command time but never become sources themselves.
- **`query`** picks one **target source** from the **source registry** and resolves it: **pass-through** when the target is an endpoint or a **Disk-backed glob**, **materialized** otherwise. When an RDF output format (`turtle`, `trig`, `nquads`) is requested and the query is a **triple-shaped SELECT**, the result rows are reified as triples or quads before serialization; a non-triple-shaped SELECT with an RDF format is a hard error. Extension inference applies: `.trig` → TriG, `.nq`/`.nquads` → N-Quads.
- **`serve`** exposes the **served registry**; resolution per source follows the same rules as `query`.
- **`hash`** picks one **target source** and always **canonicalizes** the resolved Store; it refuses any raw **pass-through** target (endpoint or **Disk-backed glob** — must be scoped with an **inline query**) and refuses an arbitrary-SELECT **inline query**.
- **`diff`** picks one **target source** per side and dispatches by query shape: **graph diff** when both sides produce triples; **tabular diff** when both sides project arbitrary SELECT tuples with matching variable names. Mixed-shape pairs are rejected. Both modes refuse a raw **pass-through** target (endpoint or **Disk-backed glob**) on either side.
- A **Disk-backed glob** rejects the **Annotate-source transformation** (the **Glob index** cannot persist RDF-star quoted triples) and carries no **Source record sidecar**; `hash` and `diff` accept it only via the **pass-through** path (the user supplies a scoping **inline query**, which runs against the **Glob index**). A declared **Graph-name transformation** mode is baked into the **Glob index** at build time.
- The disk-backed storage selector is valid only on glob and file sources; a **Split glob**'s synthesized **File source** children inherit it and are indexed independently of the meta and of each other.
- A **Pinned source** is a **Glob source** resolved against a git revision; the glob's transform pipeline applies unchanged, and when the glob is also a **Split glob**, the meta enumerates files from the git tree at the resolved SHA (not the working tree). Synthesized **File source** children inherit the pin alongside the transform pipeline.
- A **Pinned source** keys on the resolved SHA, never the user-facing ref string. A **Pinned ref** is reproducible across fetches; a **Floating ref** is not, and the resolved SHA is what surfaces in any source records or diff reports.
- Pinning applies directly to a **Glob source** (e.g. `@data:v1.2`); there is no chain to propagate a ref through. Cross-source `SERVICE` clauses in an **inline query** reference endpoints by URL and are never pinned.
- A **Glob source** may declare a **Source transformation pipeline**; transforms run in array order at load time before the Store is exposed to resolution. A **Split glob**'s synthesized **File source** children inherit the pipeline.
- A **Glob source**'s **Union default graph** setting is applied as a query-context option at every SPARQL execution against its materialized Store — including an **inline query**'s execution against that glob. It is orthogonal to the **Graph-name transformation**: `flatten` destructively drops graph names, whereas **Union default graph** is a non-destructive query-time option that leaves named graphs addressable.
- A **Split glob** is targetable as the union (`@meta`) and as any of its children (`@meta/<relative-path>`); a child may serve as a CLI target or a selection in the webapp picker. The single-target rule is preserved — both the meta and any one child are single targets; the picker remains single-select on `query`/`hash`/`diff`.
- The **Annotate-source transformation** projects **Source records** as RDF-star into the glob's loaded Store for SPARQL queryability; an **inline query** sees the projection only if it references those RDF-star triples, and **Canonicalization** strips them. The projection is independent of the **Source record sidecar** that `diff` consumes.
- `diff` (in **graph-diff** mode) consumes the per-side **Source record sidecar** carried by every in-memory glob/file target; a side resolved via **pass-through** (endpoint or a **Disk-backed glob**) carries no sidecar, so diff runs but emits one boundary-log `warn` per such side and the `html` format's **Source-file snippet** sections render empty. Explicit **Annotate-source transformations** in the user's config emit RDF-star into the Store independently and do not feed diff. Source records are surfaced across every graph output format.
- Every command that renders IRIs reads the project-config `context:` block under one rule: prefix map = built-in defaults ∪ `context.prefixes` (config wins); base = `context.base` as strict fallback after prefix match.
- The **Describe page** runs **describe** against exactly one selected source, which dispatches per source kind: `glob` targets materialize and run the full describe fixpoint; `endpoint` targets fetch depth-0 only, with deeper expansion driven by **describe expansion paths**; `empty` is rejected as a top-level describe target; `reference` is rejected.
- A describe request targets a single source; when `source` is omitted on the wire it resolves to the registry's **default source**. A source that fails to describe errors the request as a typed `Result` error — there is no best-effort multi-origin aggregation, no per-source membership, and no per-quad provenance annotation.
- A **Saved query** is webapp-scoped state: it is _not_ a **Source**, never appears in the **source registry**, and never resolvable via `@id`. There is no config-declared query counterpart — a **Saved query** is the only named query artifact, and it is webapp-scoped. A **Templated saved query** carries a `parameters:` list (one entry per **Parameter declaration**); at run time the webapp builds a `VALUES` clause from the user-supplied values and prepends it to the body via client-side substitution, then runs the substituted SPARQL through the server as ordinary query — `serve` does not learn about templates.
- Reading and writing the **Saved-query sidecar** is the **only** path by which `serve` mutates project files. Writes use optimistic concurrency, so concurrent edits from two browsers surface as visible conflicts rather than silent data loss. Under `serve --read-only`, the library is loadable but immutable, and the **Sources page**'s per-entry admin triggers are likewise refused.
- The webapp deep-links **Saved query** loads via a URL slug parameter plus per-parameter binding keys (multi-cardinality values supplied as repeated keys). This is mutually exclusive with the inline-SPARQL URL form — editing a loaded saved-query body on a **Saved-query run surface** transitions the URL to the inline form. Persisting the edit requires opening the slug on the **Saved-query authoring surface**; run surfaces carry no Save, Save-as, or "modified from `<slug>`" affordance.
- Loading a **Saved query** is source-agnostic: the user's currently-selected source is untouched, and the artifact persists no `lastUsedSource` or `intendedSource` field.
- The **Saved-query authoring surface** is the single write surface for the **Saved-query sidecar**; the **Saved-query run surfaces** are read-only against it. `serve --read-only` collapses the authoring surface to browse-and-run without changing the run surfaces (which never write to begin with).
- Webapp test layers are exclusive and exhaustive: every behavior worth covering lives in exactly one of (1) a pure-function unit spec on extracted logic, (2) a **DOM-free spec** — including page/component classes read through their public surface — or (3) **Web e2e** when the assertion needs a rendered template. Specs that render a fixture (call `detectChanges`) and assert on the rendered DOM are not a layer — they collapse into (3).
- **Web e2e** runs against a real `serve` booted on a fixture project config; it does not stub HTTP, SSE, or the saved-query sidecar. The **E2E** lane (cli) and **Web e2e** lane are independent processes with independent fixtures and independent CI targets.
- **Accessible selectors** are the default for **Web e2e**; the **Test escape hatch** (`data-testid`) is allowed only when no accessible selector disambiguates the target, and each surviving use is reviewed against fixing the markup first.

## Flagged ambiguities

- **"Materialize"** had been used to mean both "load a target into a Store" and "produce the final result"; resolved — **materialized** refers only to the resolution path that loads a target into an in-memory Store. An **inline query**'s output is "produced" or "computed", never "materialized".
- **"View"** was a first-class **Source** kind that scoped an upstream via a SPARQL query, with chains, a result cache, and pin-propagation; resolved — removed entirely. Derivation is now an **inline query** at command time (over globs, persist by baking to a disk store); the SERVICE-composition case runs against an **Empty source**.
- **"Pushdown"** appeared informally as a synonym for **pass-through**; resolved — the canonical term is **pass-through**.
- **"`annotate` transform"** (legacy name) was renamed to **`annotateSource`** to disambiguate from a hypothetical future "annotate by inference" or "annotate by SHACL"; resolved — only `annotateSource` parses.
- **"Source record"** had been defined as the RDF-star blank-node structure emitted by the `annotateSource` transform, but the diff command (which never wrote SPARQL queries against it) was the only first-class consumer. Resolved — the canonical referent is the in-memory `{file, line, …}` struct carried as a **Source record sidecar** by the loader; the RDF-star form is now described as a _projection_ authored by the **Annotate-source transformation** for SPARQL queryability and is independent of the sidecar.
- **"context"** carried two meanings: snippet context lines on `diff`'s `html` output, and JSON-LD-style display config (prefix map + base). Resolved — the snippet flag is `--snippet-context K` and the **Source-file snippet** definition speaks of "snippet context lines"; the unqualified noun **context** refers only to the project-config `context:` block (display config: prefix map + base).
