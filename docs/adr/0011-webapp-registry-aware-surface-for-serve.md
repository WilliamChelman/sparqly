---
status: accepted
amends: 0005
---

# Webapp registry-aware surface for `serve`, starting with `diff`

## Context

The webapp shipped with `serve` today is a thin Yasgui playground pointed at a single `/api/sparql`. That endpoint targets exactly one source (the **target source** picked by the standard precedence in ADR-0005). As we begin moving CLI features into the webapp — starting with **`diff`** — the single-target abstraction stops fitting. `diff` takes one target *per side*, with optional per-side anonymous-view scoping queries, optional auto source annotation (ADR-0008), and optional source-file snippet rendering (ADR-0007). Two registry-pickers and two SPARQL editors next to a Yasgui page that can't switch sources is jarring; a `/api/diff` endpoint that operates on `@id`s next to a `/api/sparql` that doesn't is asymmetric in a way that will get worse with every future feature pulled in.

The driving question is whether `serve`'s "single target source at command boundary" contract from ADR-0005 should be amended for the *long-running surface* case.

## Decision

`serve` operates in one of two modes:

- **Registry mode** (default, no `--source`/positional): every non-`reference` source in the registry is exposed simultaneously. SPARQL surface is `/api/sparql/<id>` per `@id`. New `GET /api/sources` lists registry entries. New `POST /api/diff` pairs any two `@id`s. The **default source** (`default: true`) becomes the SPA's initial selection.
- **Single-source mode** (`--source` or positional given): exactly one source from the registry, or an inline glob/URL via the positional. Behaviour matches pre-amendment `serve`: one `/api/sparql`, no `/api/diff`, no source picker in the SPA. Preserves quick-start gestures (`sparqly serve foo.ttl`).

ADR-0005's "single target source at command boundary" contract is amended accordingly: `query`, `hash`, `diff` are unchanged; `serve` is carved out, with single-source mode preserving the original semantics under an explicit opt-in.

### Eagerness splits by resolution mode, not by registry membership

In Registry mode, **materialized** sources (glob, empty, view-on-{glob,empty,view}) are resolved eagerly at boot, each holding its own `StoreRef`. **Pass-through** sources (raw endpoints, views-on-endpoints) are inherently lazy — the engine is just Comunica configured against the remote URL, no boot work, errors surface on first query. This is the same split that already applies in single-target `serve`; the change is only that it now runs N times instead of once.

### `--watch` extends per-source

Under `--watch` in Registry mode, the watcher chain runs once per non-pass-through source: each glob source's chain is watched, each cached view's TTL/freshness probe runs, all sharing one chokidar instance with deduped base directories. Pass-through sources skip watching, with the existing per-source warning.

### Webapp `diff` shape

`POST /api/diff` body: `{ left: '@id', right: '@id', leftQuery?: string, rightQuery?: string, skipAutoSourceAnnotation?: boolean }`. Inline globs/URLs are rejected from the browser — only `@id`s into the registry are accepted, removing the path-traversal and SSRF surface.

Response: JSON-shaped, branched on `kind`:

- `{ kind: 'graph', diff: RdfDiffResult, sourceRecords, totals }` when both sides are triples-shape.
- `{ kind: 'tabular', diff: TabularDiffResult, totals, variables }` when both sides are arbitrary-tuple SELECTs with matching variable sets.
- `{ kind: 'error', errors: { left?, right?, top? } }` when one or both sides fail; both sides surface together rather than fail-fast.

Mode dispatch reuses the CLI's `detectTabularDispatch`. The auto source annotation default mirrors the CLI: implicit injection on glob targets in graph-diff mode unless `skipAutoSourceAnnotation: true`.

`/api/diff` resolves per request — it does **not** reuse the Stores held by `/api/sparql/<id>`'s engines. The reason is annotation state: a SPARQL engine's Store reflects a source's *declared* annotation (annotated iff config declares `annotateSource`), while the diff handler may need the opposite state for the same source within the same `serve` process. Reuse would force one of: (a) eagerly hold two Stores per glob source (memory cost), (b) eagerly annotate every Store (pollutes SPARQL query results with RDF-star records), or (c) snapshot-and-conditionally-reload (fragile invariant). Re-resolving per request is simpler and matches CLI semantics; OS file cache and `--watch` keep repeated reads cheap. Reuse remains open as a future optimization keyed on `(source @id, annotation predicates)` if profiling justifies it.

### Source-file snippets are a new server primitive

`GET /api/source-snippet?file=<file://uri>&line=N&context=K` returns the same `SnippetReadResult` shape `readSourceSnippet` already produces, with `(source file unavailable)` degradation when the file disappears between load and request. Always-on; no opt-in flag. Rationale: the snippet bytes are bounded by what the SPARQL endpoint already discloses (the loader read them to populate the Store; SPARQL queries already return their content), so the marginal disclosure is line numbers and non-RDF text (comments, whitespace) — inside the same trust boundary `serve` already crosses.

Allow-list: the static set of absolute file paths the loader actually opened during materialized resolution, refreshed on every `--watch` rebuild. Requests for files outside the set return 403. The set is registry-wide — any glob source's loaded file is readable, regardless of which `@id` was diffed.

### SPA navigation

Two top-level routes: `/` (Yasgui playground) and `/diff` (diff page). A header nav switches between them. Yasgui's existing component is preserved; a new `app-diff-page` component owns its own state. URL state on `/diff` (left/right `@id` and queries) is deferred. Empty-or-single-`@id` registries surface an empty state on `/diff` rather than hide the route.

### Out of scope for this ADR

- **Per-source `mutable`** stays out: `mutable` remains a registry-wide flag (logged in `ideas.md`). With Yasgui-as-registry-aware, individual `@id`s plausibly want independent read-only/mutable policies, but the design isn't load-bearing for the v1 webapp diff and would couple this ADR to a separate decision.
- **Format flags `--prefixes` / `--base`** are not exposed on `/api/diff`. Both shape *text* outputs; the JSON-shaped API leaves prefix shortening to the SPA renderer.
- **Caching diff results** (already noted in `ideas.md`) — no v1 mechanism. `--watch` already keeps SPARQL Stores fresh; diff-result caching is a follow-up if real workloads justify it.
- **Concurrency throttling** — none. `serve` is documented as a single-user development tool.

## Considered alternatives

- **Drop `--source` entirely from `serve`.** Rejected: kills `sparqly serve foo.ttl`, the single most common quick-start gesture, and breaks any script that passes a positional. Restriction-mode preserves the gesture without splitting `serve` into two binaries.
- **Keep `--source` as a default-tab hint only** (registry always fully served, flag just sets initial Yasgui selection). Rejected: misnames the flag and removes the only way to expose a single source for security/scope reasons. Some users genuinely want one-source exposure.
- **Server-side render diff to HTML and ship verbatim to an iframe.** Rejected: minimum new code, but no filtering/sorting/click-through and no future for additional CLI features in the SPA. Sets a poor precedent. JSON-API + SPA rendering matches what `/api/sparql` already does.
- **Allow inline globs/URLs in `/api/diff` request bodies.** Rejected: globs from a browser open path traversal; endpoint URLs from a browser open SSRF. Forcing `@id`s through the registry is the same gesture users already make to expose anything to `serve`.
- **Reuse the SPARQL engine's Store for diff** (with snapshot-at-request-start). Rejected for the annotation-state reason above. The reuse seemed cheap until the ADR-0008 auto-injection state was factored in.
- **Two Stores per glob source** (declared + auto-annotated). Rejected: doubles memory for the lifetime of `serve`, for an optimization the CLI doesn't need.
- **`--allow-snippets` flag gating the snippet endpoint off by default.** Rejected: snippet reads are inside the SPARQL trust boundary already, the "scary new file-reading surface" framing overstates the marginal disclosure. Always-on with documented surface widening is the cleaner contract.
- **Per-session token allow-list for snippets** (token returned by `/api/diff`, validated on `/api/source-snippet`). Rejected: stateful, gnarly, and offers no real protection over the static loader-set allow-list — both equally bound the disclosure to files the registry already loaded.
- **Yasgui stays single-target in this milestone**, registry-aware SPARQL deferred. Considered seriously; rejected because the asymmetry (registry-aware diff next to single-target SPARQL) is exactly what this ADR is trying to resolve.
- **Symmetric `--query` mode in the SPA** (one editor, broadcast to both sides). Rejected: a dual-editor UI collapses to "type the same query in both editors" trivially, and dual-editor is required anyway for tabular dispatch (matched variable-name sets per side).

## Consequences

- **`serve` CLI shape**: positional/flag becomes optional; absence triggers Registry mode. Help text and README gain a "Registry mode vs Single-source mode" section. The line about "intended for single-user development; not hardened for concurrent users" is added to both.
- **`createServer` API** (`libs/server`): `target` becomes optional. When omitted, the server boots N engines (eager for materialized, lazy for pass-through) and serves `/api/sparql/<id>` per `@id`, plus `/api/sources`, `/api/diff`, and `/api/source-snippet`. When present, behaviour is unchanged (Single-source mode).
- **SPARQL controller**: route param `:id` resolves the `@id` to its engine. 404 on unknown `@id`. Single-source mode keeps the unparameterized `/api/sparql` route.
- **Watcher chain**: `buildWatcherChain` extends to enumerate every non-reference source; the per-source dedupe of glob bases prevents chokidar fanout. Each source's `StoreRef` is updated independently on rebuild; cross-source rebuilds are independent.
- **Loader allow-list side-channel**: the loader emits the absolute file paths it opened during materialized resolution, accumulated across all sources. Refreshed on watch rebuild. Consumed by the snippet endpoint.
- **Web bundle**: gains a `/diff` route, a header nav, an `app-diff-page` component, and a snippet renderer component. `app-yasgui-page` is unchanged in v1; future milestones may make Yasgui's source picker registry-aware.
- **Threat surface**: `serve` now reads ad-hoc files at network request time (bounded by the loader allow-list). README and `serve --help` document this.
- **CONTEXT.md**: gains **Registry mode** and **Single-source mode**; `Target source` and `Default source` definitions are rewritten to note `serve`'s carve-out and the SPA-initial-selection role.
- **ADR-0005 listing** of `serve` as a single-target command becomes "amended by ADR-0011": single-target semantics are preserved under Single-source mode but no longer the default.
- **Breaking change**: configs/scripts that depend on `serve` always picking one target now boot in Registry mode unless they pass `--source`. This is the opposite default of today. No deprecation window — sparqly is alpha.
