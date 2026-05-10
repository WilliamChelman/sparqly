---
status: accepted
amends: 0011
---

# Webapp turtle/trig view, formatted in the browser via `libs/common`

## Context

The query page's result pane today offers three tabs — `table`, `raw`, `download` (`apps/web/src/app/pages/query/components/result/result-pane.component.ts`). For a triples-shape result (CONSTRUCT/DESCRIBE responses, decoded as `TripleResult`) the `table` tab renders a virtualized subject/predicate/object grid; `raw` shows whatever the server emitted over the wire (typically Comunica's terse Turtle); `download` offers `Turtle` (the raw response) and `N-Quads` (a hand-rolled serializer). None of these match what `sparqly format` produces — the canonical, prefix-shortened, list-detecting, object-anchored Turtle/TriG body that the CLI is built around.

The user-facing gap is that the webapp's "Turtle" is not the project's Turtle. A user inspecting the result of a CONSTRUCT in the playground sees something that does not round-trip with the format command they will run on the same data minutes later. Closing that gap requires the `format` command's exact output as a render target on the query page, downloadable verbatim.

Two architectural forks fall out of that requirement:

1. **Where formatting runs.** `formatRdf` lives in `libs/core` and is browser-safe (n3.Writer, no Node-only deps), but the webapp does not import `core` today — and `core` carries large amounts of Node-only surface (rdf-loader, view-cache, source-snippet-reader, source-spec parsing) that the webapp has no business pulling. Opening `core` to the webapp would set a "browser can import any of this" precedent the surface cannot honour. `libs/common` already exists as the established home for browser-safe utilities the SPA imports (today: `shortenNQuadLine`, `bestPrefixEntryFor`, `DEFAULT_PREFIXES`, used by the diff page); it is the natural extension point. The alternatives are: open `core` to the webapp; extend `libs/common` with the formatter and `parseRdfString`; create a third sibling lib; or have the server reformat on demand via Accept negotiation or a new `/api/format` endpoint.
2. **What "compatible query" means.** CONSTRUCT/DESCRIBE responses are already triples on the wire. SELECT-{?s,?p,?o[,?g]} is recognized elsewhere in the codebase (CONTEXT.md: views, hash, graph-diff) as a triples-shape, but the wire encoding is `application/sparql-results+json`, not Turtle — it would have to be reified before it can be formatted.

ADR-0011 sets a precedent the answer should respect: "the JSON-shaped API leaves prefix shortening to the SPA renderer" (line 58). Text shaping is already an SPA concern for diff. The same logic applies here, but it generalizes: even text-API responses (the Turtle that comes back from `/api/sparql/<id>`) can be reshaped client-side when the SPA wants a different presentation. The server's job is to return correct RDF; the SPA's job is to render it.

## Decision

The query page's result pane gains a fourth tab, **`turtle`** (or **`trig`** when any quad in the result carries a non-default graph), placed between `table` and `raw`. Its body is the output of `formatRdf` from `libs/core`, run in the browser, byte-for-byte identical to what `sparqly format` would produce on the same triples with the same prefix/base inputs. The tab is hidden when the result is not triples-shape.

### Trigger: triples-shape, with browser-side SELECT-spo reification

The tab surfaces in two cases:

- **Wire-triples**: the server returned `text/turtle` / `application/n-triples` / `application/n-quads` / `application/trig`, decoded as `TripleResult`.
- **Reified-triples**: the server returned `application/sparql-results+json` and the SPA detects a SELECT projecting `{?s,?p,?o}` or `{?s,?p,?o,?g}` (variable-name match, position-independent — same canonical pattern referenced by views/`hash`/graph-diff in CONTEXT.md). The SPA builds a `Triple[]` in-memory, skipping rows that have any unbound binding or a non-NamedNode predicate. This mirrors the contracts `hash` and graph-diff already enforce on declared views.

Detection runs on the decoded `DecodedResult` already in the result pane; no server change. SELECT-spo queries do not gain a new wire shape — the existing `application/sparql-results+json` request/response is reused, with reification a pure renderer concern.

### Locus: browser, via `libs/common`

The formatter (`formatRdf`, `FormatSerialization`, `ResolvedFormatterConfig`) and `parseRdfString` extract from `libs/core` into the existing `libs/common` lib. The webapp imports `from 'common'` (already an established import path on the diff page); the CLI's `format.ts` updates its import from `from 'core'` to `from 'common'`; `libs/server` likewise where it touches the formatter.

`libs/common` is the right home: it is already the established sibling lib for utilities shared between the CLI and the webapp, the SPA already imports from it today, and its charter is broad enough to absorb shared types, interfaces, and utilities going forward — including the formatter and `parseRdfString`. The reason for putting these primitives in a sibling lib rather than opening `core`: `core` aggregates Node-only surface (rdf-loader, view-cache, source-snippet-reader, transform pipeline, env-substitute) that has no business in a browser bundle. A `webapp imports core` precedent would invite those modules into the SPA over time. `common` is the deliberately browser-safe surface where shared concerns belong.

The SPA calls `formatRdf` from `common` with the `Triple[]` (wire-triples directly, reified-triples via the path above), plus the prefix/base inputs derived below. Output is the formatted body; the tab renders it as a single `<pre>` block (no virtualization — the format command's output is a contiguous text artifact, not a row stream). n3.Writer (already a transitive of n3.Parser, which the SPA uses today via `sparql-result-decoder.ts`) handles the heavy lifting inside `formatRdf`.

### Prefix and base inputs match the format command's `mergePrefixes`

`formatRdf` is fed:

- **prefixes**: `responsePrefixes ∪ context.prefixes`, with `context.prefixes` winning on conflict. `responsePrefixes` is what n3.Parser surfaces from the Turtle body (empty for SELECT-spo reification — the JSON wire format carries no prefix declarations). `context.prefixes` is the `DisplayContext` already plumbed through the page from `GET /api/config`. The merge mirrors `apps/cli/src/app/commands/format.ts`'s `mergePrefixes` byte-for-byte.
- **base**: `context.base` if set, else the Turtle body's `@base` directive if n3.Parser exposed one, else undefined. Same precedence as the CLI.
- **objectAnchoredPredicates**: not exposed in v1. The CLI carries this on the `format:` config block; the webapp does not surface a render config. Future amendment if real demand emerges.

The `DEFAULT_PREFIXES` (rdf/rdfs/owl/xsd) handling is internal to `formatRdf` and unchanged — the SPA does not pre-merge them.

### Compute is lazy on tab activation, memoized per result

`formatRdf` runs the first time the user clicks the `turtle`/`trig` tab for a given result, and the output is held on a computed signal keyed on the current `DecodedResult` identity. Switching back to `table` and back to `turtle` does not recompute. A new query (new `DecodedResult`) discards the cached output. No size cap — large results stall the tab switch, but the user can switch back at any time and the table tab is unaffected.

This is consistent with the format command's behavior: the CLI computes the full output once per invocation. The SPA matches.

### Downloads are unified to the formatted output

The `download` tab's `Turtle` option becomes the formatted output (replacing the previous "raw response or N-Quads fallback" path). When any quad in the result carries a non-default graph, the option label, filename, and media type flip:

- Default-graph-only: `Turtle` / `result.ttl` / `text/turtle`
- Any named graph: `TriG` / `result.trig` / `application/trig`

The `N-Quads` option is unchanged — it remains the unformatted, lossless, line-based fallback for users who want exactly that.

SELECT-spo queries that reify into triples gain a Turtle/TriG download they did not have before; previously such results offered only `CSV`/`TSV`/`JSON`. The reified path is the same as the formatted-tab path — one source of truth for "this result as triples".

### What the tab is _not_

- **Not a graph visualization**. It is a text view of formatted Turtle/TriG, identical to the format command's stdout. Visualization is a separate concern.
- **Not a SPARQL Update target**. Read-only render, like every other tab in the result pane.
- **Not a server endpoint**. There is no `/api/format`; the formatter runs client-side, and the same SPARQL response feeds both the table view and the formatted view.

## Considered alternatives

- **Server-side reformat via Accept negotiation on `/api/sparql/<id>`** (e.g. `Accept: text/turtle; profile=sparqly-format` or `?format=ttl-pretty`). Rejected: collides with ADR-0011's "JSON API leaves text shaping to the SPA renderer" precedent. Generalizing that precedent to text APIs (which is what this ADR does) is the consistent move; carving out an exception for the format command would multiply special cases. Also forces a wire contract for "what the format command produces today" — every CLI-side formatter tweak becomes a server-API change.
- **Dedicated `POST /api/format` endpoint**. SPA POSTs raw Turtle, server returns formatted. Rejected: the server already sent the data; re-parsing it on the round-trip is waste, and the new endpoint adds a surface that means the same thing as "run formatRdf in the browser" but slower. The SPA already runs n3.Parser on the same body to populate the table view; running n3.Writer next to it is the cheap path.
- **Open `libs/core` to the webapp directly** and rely on tree-shaking to keep the bundle small. Rejected: the issue is not bundle size but surface contract. Once `webapp imports core` exists as precedent, the next contributor adding a webapp feature reaches into `core` for whatever sits closest to their need — and `core` hosts Node-only modules (rdf-loader, view-cache, source-snippet-reader) that should never reach the browser. A separate browser-safe lib makes the surface explicit and review-checkable; tree-shaking is a runtime safeguard, not a contract.
- **Sub-entrypoint inside `core` (e.g. `core/render`)** that the webapp imports while the rest of `core` stays Node-only. Rejected: a single library with conditional surfaces is harder to reason about than two libraries with explicit purposes. The codebase already organizes shared concerns by sibling libs (`common` for browser-safe shared utilities, `domain` for value types, `core` for command logic, `server` for the HTTP layer); the formatter slots into `common` without inventing a new convention.
- **New `libs/render` sibling lib** dedicated to RDF text rendering primitives. Rejected: `libs/common` already plays the role of "browser-safe shared utilities for the CLI and the webapp" and is already imported by the SPA. Adding a third sibling lib for the same charter splits the surface for no win — every future browser-safe shared primitive would face the same "common or render?" choice with no clean dividing line. Putting the formatter in `common` keeps the sibling-lib map at four (`common`, `core`, `domain`, `server`) with each lib's purpose intact.
- **CONSTRUCT/DESCRIBE only, defer SELECT-spo**. Smallest patch — only `TripleResult` triggers the tab. Rejected: SELECT-{?s,?p,?o[,?g]} is already a recognized triples-shape across the codebase (CONTEXT.md: views, hash, graph-diff), and the reification logic is small (one function on the decoded `SelectResult`). Cutting the scope would make the playground inconsistent with the rest of the project's "what counts as triples" contract.
- **Server-side detection of spo and Accept negotiation to swap wire shape**. SPA detects spo pre-flight, sends `Accept: text/turtle`. Rejected: depends on Comunica's behavior matching expectations for arbitrary spo SELECTs and entangles the SPA's request shape with renderer concerns. Browser-side reification is self-contained and matches the established pattern of "renderer figures out what the user sees, server returns correct RDF/results".
- **Eager compute (run formatRdf on every result)**. Tab switch is instant. Rejected: wastes work on every result for users who never click the tab — and a 100k-triple CONSTRUCT would block the result pane for seconds even for users who only want the table. Lazy + memoized matches the format CLI's compute model.
- **Soft size cap with "Format anyway" override above N triples**. Protects users from accidental long stalls. Rejected for v1: adds UI surface for a problem that's not yet observed in real use; the table tab remains unaffected by formatting time, so the user can always switch back. Revisit if a real workload triggers a stall worth gating.
- **Replace the `raw` tab with `turtle` for triples-shape results**. Fewer tabs. Rejected: `raw` retains debugging value (seeing exactly what the server emitted, including Comunica idiosyncrasies) that the formatted view destroys. The two answer different questions.
- **Tab label `formatted` instead of flipping `turtle`/`trig`**. Stable label, format-agnostic. Rejected: the project speaks Turtle and TriG by name everywhere — the CLI's `format` command, the diff output formats (`-f turtle`), CONTEXT.md throughout. Calling the view by the serialization it produces is consistent; "formatted" is generic and would invite "formatted as what?" every time.
- **`Turtle (raw)` and `Turtle (formatted)` both offered**. Rejected: bloats the download menu and reproduces the same "which Turtle is the real one" confusion this whole ADR is trying to resolve. The format command is the project's Turtle. N-Quads remains for the lossless line-based fallback.
- **Webapp opt-in flag (`?format=on` or a setting)**. Rejected: the tab is conditional already (only triples-shape results), and it adds zero cost when hidden. Hiding a working feature behind a flag for no gain is friction.

## Consequences

- **`libs/common` grows**: gains `formatRdf`, `FormatSerialization`, `ResolvedFormatterConfig`, and `parseRdfString` (extracted from `libs/core/src/lib/formatter.ts` and `libs/core/src/lib/parse-rdf-string.ts`), exported from `libs/common/src/index.ts`. The path alias `common` already exists in `tsconfig.base.json` and is already imported by the SPA. The bundle gains `formatRdf` and its transitive `n3.Writer` (small; n3.Parser is already in the bundle).
- **`common`'s charter generalizes**: from "small browser-safe helpers" (prefix shortening, default-prefixes) to "browser-safe utilities, types, and interfaces shared between the CLI and the webapp". Future shared types/utilities land here too.
- **CLI and server import-path migration**: `apps/cli/src/app/commands/format.ts` and any `libs/server` reference to the formatter switch from `from 'core'` to `from 'common'`. Compile-time only; no behaviour change.
- **`libs/core` shrinks**: the formatter and `parseRdfString` files relocate; `core/src/index.ts` drops their re-exports. `core` retains everything Node-coupled (rdf-loader, view-cache, transforms, source-snippet-reader). If any internal `core` modules consume the formatter or `parseRdfString` after extraction, they import from `common`; `common` never imports from `core`.
- **New result-pane tab**: `turtle`/`trig`, conditional on triples-shape (wire or reified). The tab list type extends from `'table' | 'raw' | 'download'` to `'table' | 'turtle' | 'raw' | 'download'`.
- **New utility on the result-pane**: a SELECT-spo reifier that converts `SelectResult` (with vars matching `{?s,?p,?o}` or `{?s,?p,?o,?g}`) into `Triple[]`. Lives under `pages/query/utils/` per ADR-0013's placement rules. Skip semantics (unbound bindings, non-NamedNode predicates) match `hash`/graph-diff.
- **Download surface narrows in label, broadens in coverage**: `Turtle` becomes formatted-only and flips to `TriG` for named-graph results; SELECT-spo reified results now offer Turtle/TriG downloads; `N-Quads` is unchanged.
- **CONTEXT.md update**: the renderer enumeration in the Context-block paragraph (today: "`format`'s Turtle/TriG output, `diff`'s `human`/`rdf-patch`/`turtle`/`html` output, `query`'s Turtle output, the webapp's diff renderer for tabular cells, hunk anchors, and hunk lines") gains "the webapp's query-page turtle/trig view". No new term is introduced — the view is UI surface, not domain language.
- **ADR-0011 generalization**: "the JSON-shaped API leaves prefix shortening to the SPA renderer" extends to "text-API responses are also reshaped client-side when an alternative formatted view is offered". No conflict with ADR-0011's body; this ADR documents the wider rule the next time someone reaches for a server-side reformat.
- **No new server endpoint, no new wire contract**. `/api/sparql/<id>`, `/api/sources`, `/api/diff`, `/api/source-snippet`, and `/api/config` are unchanged. The threat surface is unchanged.
- **No CLI change**. `sparqly format`'s contract is unchanged; the SPA reads its output via `formatRdf`, the same function the CLI calls.
- **Performance characteristic**: the `turtle`/`trig` tab is O(N) in result triples on first activation, then O(1) on tab re-activation until the next query. The `table` tab is unaffected. No size limit; the user can switch tabs at any time.
- **objectAnchoredPredicates is not exposed in v1**: the CLI's per-config knob does not surface in the SPA. Add when a real consumer asks; the renderer config plumbing would be a small `/api/config` extension.
