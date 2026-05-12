---
status: accepted
amends: 0005, 0011
---

# Webapp describe page with multi-source aggregation

## Context

A common need when exploring an RDF dataset is "show me everything about this IRI." SPARQL's native `DESCRIBE` verb nominally serves this, but its semantics are implementation-defined — different engines return different shapes, and what's returned over a federation/SERVICE boundary depends on the remote engine. For a UX where a user clicks an IRI and expects a stable, predictable view, "whatever Comunica's DESCRIBE happens to return today" is not a contract we want to hand to users.

The webapp has begun moving CLI features into a long-running surface — `serve` (ADR-0011) carved out **Registry mode** so `/api/diff` could pair two `@id`s, softening ADR-0005's "single target source at the command boundary" rule. A "describe a URI across the entire registry" page extends the same gradient — from one target (`query`), to two (`/api/diff`), to `[0..n]` (`/api/describe`). The driving question for this ADR is whether that extension is principled or ad-hoc, and what shape it takes.

Three concerns intertwine and force a single ADR rather than three:

1. **What "describe" means in sparqly.** Delegating to native SPARQL `DESCRIBE` gives non-deterministic output and lacks RDF-star handling. A custom algorithm gives a stable contract.
2. **Multi-source aggregation in the webapp.** ADR-0005's single-target rule has been carved out twice now; the carve-out pattern needs documenting before a third arrives.
3. **Per-quad provenance vs. user-authored RDF-star.** The page must surface "which registry source returned this quad" without conflating with user-authored RDF-star annotations or with the existing `annotateSource` machinery (ADR-0006, ADR-0008).

Caps and a hard ceiling matter because describe at the registry level is unbounded by query shape — a high-fanout seed IRI or pathological bnode graph can fan out to millions of quads. Soft and hard limits live in config so deployments tune them once.

## Decision

A new webapp page `/describe?iri=<encoded>&sources=<csv>` runs sparqly's own **describe** algorithm against `[0..n]` registry sources and renders the merged result. Backed by `POST /api/describe` in `libs/server`, built on two pure primitives in `libs/core` (`describeStore`, `describeEndpoint`). A new top-level `describe:` config block carries registry-wide defaults.

### The describe algorithm

A symmetric concise bounded description of a seed IRI:

1. Emit every quad `q` whose subject or object equals the seed IRI.
2. For every blank node appearing in subject or object position of any emitted quad, add every quad mentioning that bnode in either position. Repeat to fixpoint, capped at `perSourceLimit` quads. Bnode-cycle dedupe is implicit in the fixpoint.
3. Do **not** traverse to other named IRIs — named-IRI fanout is a UI click-through concern (a "describe this" affordance next to each rendered IRI), not an algorithm concern.
4. After the fixpoint, include any quad whose subject is an RDF-star quoted triple `<< s p o g >>` *iff* `(s, p, o, g)` is already in the result set. Annotations on quoted triples *not* already in the set are not pulled in.

Distinct from SPARQL `DESCRIBE`; the codebase deliberately does not delegate to it.

Two primitive functions in `libs/core`:

- `describeStore({ store: Store, seed: NamedNode, perSourceLimit: number }) => { quads: Quad[], truncated: boolean }` — iterative pattern-match over the in-memory Store.
- `describeEndpoint({ engineSource: ParsedEndpointSource, seed: NamedNode, perSourceLimit: number }) => { quads: Quad[], truncated: boolean }` — issues iterative CONSTRUCTs over the wire via Comunica. Multiple round-trips per endpoint (one per fixpoint round) — acceptable because the safety cap bounds them and describe is inherently a small-result page.

### Source-kind dispatch at `/api/describe`

Per selected source, dispatch by kind:

- **`glob`** and **`view`** — call `resolveSource(target, { registry })`, then `describeStore` on the resulting Store. Views with endpoint upstreams pay full materialization for every describe call; this is acceptable because the view's own scoping query is the throttle, and the user opted into the view boundary explicitly.
- **`endpoint`** — `describeEndpoint` against Comunica configured against the URL. No local Store.
- **`empty`** — rejected (`400`) with `"empty source has no data; describe a view that scopes it"`. Empty exists only to host a view with `SERVICE` clauses; describing it directly is meaningless.
- **`reference`** — rejected per ADR-0005's existing rule.

The materialized/pass-through choice falls out of source kind directly; the dispatch logic does not parallel `resolveSource`'s mode inference for views (which can dynamically pick pass-through when the upstream is a single endpoint) — for describe, all view targets materialize. Pass-through view semantics over describe are fragile (wrapping a user's `CONSTRUCT` view query as an outer subquery with a seed-binding filter has no clean composition), and the simplification of "view ⇒ materialize" is worth the cost.

### Multi-source orchestration

`POST /api/describe` body:

```
{
  iri: string,                    // required; the seed IRI
  sources?: string[],             // @ids; omitted ⇒ all non-reference, non-empty sources
  withProvenance?: boolean,       // default true
  perSourceLimit?: number,        // default = describe.perSourceSoftLimit; clamped to ≤ describe.perSourceHardLimit
  fromSourcePredicate?: string,   // default = describe.fromSourcePredicate or "urn:sparqly:fromSource"
}
```

Sources run in parallel server-side. Response:

```
{
  iri: string,
  quads: string,                  // N-Quads, deduplicated by lexical (s, p, o, g)
  total: number,                  // count of merged quads (size of `quads`)
  perSource: {
    [sourceId]: {
      count: number,              // post-dedup membership: merged quads this source contributed to
      truncated: boolean,         // perSourceLimit fired
      error?: string              // present iff this source failed
    }
  }
}
```

`sum(perSource[id].count) >= total` is expected: a quad returned from K > 1 sources counts in K `count`s but contributes once to `total`. The UI shows `total` as the headline ("873 quads across 3 sources") and `count`s as per-source contribution breakdowns.

### Bnode rewrite at merge time

Bnodes are document-scoped in RDF — `_:b1` from source `foo` and `_:b1` from source `bar` are not the same node. Naive lexical merge would silently conflate them. Before merging, each source's quads are passed through `relabelBnodes(quads, "<sourceId>__")` in `libs/core`, giving every source a disjoint bnode label space. Effect: IRI-only quads collapse across sources via lexical dedup (and pick up multiple badges); bnode-containing quads never collapse across sources (one merged quad per origin). The rewrite is **not** RDFC-1.0 canonicalization — semantically-equal bnode chains across sources don't merge. Canonicalization is reserved for `hash`/`diff`; describe is an exploration surface where the cheaper deterministic rewrite is the right trade.

HTTP `200` if at least one source succeeded; `502` only when every selected source failed (with the same per-source error map populated). One source failing does not fail the request — describe is inherently a best-effort multi-origin surface.

### Describe provenance (RDF-star annotation, stripped at render time)

When `withProvenance: true` (default), every quad in the merged response carries one sparqly-injected RDF-star annotation per origin source:

```
<< s p o g >> <urn:sparqly:fromSource> "sourceId" .
```

The object is an `xsd:string` literal carrying the source `@id` verbatim. Source `@id`s are free-form config keys, not IRIs; inventing a synthetic `urn:sparqly:source:<id>` IRI scheme to hold them would add round-trip complexity without buying anything (the renderer strips the predicate; nobody dereferences the IRI). Same quad returned from multiple sources receives multiple annotations (one per source). The predicate is configurable via request and config; default `urn:sparqly:fromSource`.

The webapp renderer strips these annotations on receipt (predicate-match against the configured value from `GET /api/config`), deduplicates the surviving quads by lexical `(s, p, o, g)`, and surfaces source membership as per-quad UI badges. User-authored RDF-star annotations on quads in the result set remain visible inline. The net rendered effect is identical to a side-band-map payload; the wire format is RDF-star purely to keep the response self-describing as RDF and to leave the door open to consumers (e.g. a future CLI `describe` command) that want the raw annotated stream.

Two RDF-star annotation systems now live side by side in sparqly. They never share a predicate IRI and they never share semantics:

- **Source records** (ADR-0006, `urn:sparqly:source` / `urn:sparqly:file` / `urn:sparqly:line`): file authorship — *where on disk was this triple authored*. Populated by the **Annotate-source transformation** at load time. Stripped by **Canonicalization** for `hash`. Surfaced by `diff` in graph-diff output.
- **Describe provenance** (`urn:sparqly:fromSource`): registry membership — *which registry `@id` returned this quad*. Populated by `/api/describe`. Stripped by the webapp describe renderer. Never surfaced anywhere else.

A clarifying note added to CONTEXT.md and to both predicate definitions states the non-conflation explicitly.

### The `describe:` config block

A new top-level block in the project config:

```yaml
describe:
  perSourceSoftLimit: 10000      # default for requests omitting perSourceLimit
  perSourceHardLimit: 100000     # absolute ceiling; requests are clamped
  fromSourcePredicate: urn:sparqly:fromSource   # optional override
```

Read by `/api/describe` and surfaced to the webapp via `GET /api/config` (which already combines `sources` and `context`; gains `describe`). No CLI flags expose these — config-only, matching the **Context block** precedent (ADR-0012).

### Page UX

- Route: `/describe?iri=<encoded>&sources=<csv>` (new entry in `app.routes.ts`).
- Available in both **Registry mode** and **Single-source mode**. The source picker collapses to the single source in Single-source mode, mirroring the query/diff pages' use of `SourcesPickerComponent`.
- Initial state on first load: **all sources selected**.
- Zero sources selected: **empty result with a "Select all" affordance**. `[0..n]` is honest — 0 is not aliased to "all", because the user-visible action of deselecting-everything should produce a visibly-empty page, not a visibly-everything page.
- Seed IRI input: a single text field at the top of the page, plus an explicit "Describe" button. URL reflects state.
- Renders the merged quad set. (v1: the same Turtle/TriG renderer as the query page's turtle/trig view, plus per-quad source-badge chips and a "from N source(s)" header summary. **Superseded by the sectioned render below** — the plain serialized rendering survives as the `turtle`/`trig` tab.)
- Per-source errors render as small inline banners under the source-picker.

### Page UX — sectioned render (amended 2026-05)

The flat "table" view (rows grouped by subject, seed-subject group first) is replaced by an **outbound / inbound** split. The `turtle`/`trig` tab is unchanged; no third tab is added — the sectioned view *is* the default ("table") view.

- **Two sections.** **Outbound** = result quads whose subject is the seed. **Inbound** = result quads whose object is the seed. Section order: outbound, then inbound. An empty section is hidden; if both are empty the page shows the existing "No quads." message.
- **Grouped by predicate within a section.** Outbound: a predicate header (`rdf:type` rendered `a` and sorted first; the rest alphabetical), then that predicate's objects — named IRIs as **describe-this affordance** chips, literals inline, blank nodes expanded inline (see below); ordering within a group is IRIs (alphabetical, prefixed-form-aware) → literals (lexical) → inline bnode subtrees. Inbound: an inverse-arrow predicate header (all alphabetical), then the subjects pointing at the seed via it, same chip/literal/bnode treatment.
- **Blank-node nesting.** A blank node reached from the seed is rendered inline as a nested `[ … ]` block showing its own predicate-grouped properties, recursively. It is attributed to the section whose edge first reached it (bnode *objects* of outbound seed quads → outbound; bnode *subjects* of inbound seed quads → inbound; transitive closure within the result set, cycle-guarded). A blank node reachable from the seed *both* ways renders in **both** sections with its subtree duplicated — consistent with how a Turtle serializer inlines a shared bnode at each reference site. A `<seed> :p <seed>` self-loop renders once, under outbound.
- **Nesting heuristics are a light webapp-local reimplementation**, not a reuse of `formatRdf`: single-use blank node ⇒ inline, else a labeled `_:b` reference; `rdf:List` ⇒ `( … )` collection; cycle ⇒ labeled. Deliberately *not* byte-identical to the **Formatter** — this surface is interactive and decorated (every term carries chips/badges/expand), so the renderer emits a structured view-model tree rather than an opaque string. `formatRdf`'s `objectAnchoredPredicates` feature is not carried over in v1.
- **RDF-star annotations** (a quad whose subject is a quoted triple already in the result) render as a nested `{| … |}` sub-block on the annotated row, not as a standalone `<<…>>` subject group; recursion descends into the annotation the same way. `urn:sparqly:fromSource` provenance is stripped first as before.
- **Named graph** shows as a per-quad chip next to the object/subject (alongside the source badges); the default graph shows nothing. The dedicated `g` column of the old flat table is gone.
- **The blank-node expand affordance** (ADR-0019) moves from a table cell onto the dangling `[ ]` block — same trigger conditions (endpoint-origin, within the path-step cap), same `(expand)` flow up to the page (`expandedPaths` / `mergeSourceSlice` untouched). Available in both sections.
- **Unchanged:** seed input + "Describe" button + URL state, the source picker (collapses in Single-source mode), loading/error states, per-source error banners, the `turtle`/`trig` tab.

### Out of scope for this ADR

- **CLI `describe` command.** Not built in v1; the core primitives are designed to support it without further extraction. A future ADR will spec the CLI shape if one is added.
- **Describe result caching.** The **Result cache** (ADR-0004) is keyed on view queries; describe is not a view. No caching layer in v1; the per-source cap is the only bound.
- **Watching.** `--watch` rebuilds Stores; the describe page re-runs on user action, not on watch events. No subscription/SSE.
- **Quoted-triple seed.** Describing an `<<s p o g>>` is rejected in v1. RDF-star annotations whose quoted triple contains the seed IRI in subject/object position are still surfaced — the algorithm handles this naturally via the named-IRI match in step 1, since the quoted triple as a *whole* is the subject of the annotation, not the named IRI inside it. A future ADR can extend the seed type.
- **Named-IRI traversal.** The algorithm stops at named IRIs. The page's renderer adds a "describe this" click-through next to every named-IRI render; following the link replaces the seed IRI in the URL and re-runs.
- **Concurrency throttling per endpoint.** `serve` is documented as a single-user development tool (ADR-0011); no per-endpoint connection cap.

## Considered alternatives

- **Delegate to SPARQL `DESCRIBE`.** Rejected: semantics are implementation-defined, RDF-star handling is engine-dependent, and the page would behave differently per endpoint. The whole point of giving users a "describe" button is a stable, predictable view.
- **Asymmetric CBD (W3C-note variant).** Rejected: only follows bnodes outward from emitted objects. Real ontologies use bnodes in subject position (RDF lists, OWL restrictions); an asymmetric walk leaves obvious neighbours unrendered, defeating the page's purpose.
- **Include named-IRI one-hop expansion.** Rejected: balloons quickly on real graphs (think `rdfs:Class`-typed seeds), and the click-through alternative gives the user explicit control over depth without any algorithm change.
- **Algorithm in `libs/server` only.** Rejected: the pure-function shape is small (two functions, both `Store`-or-engine-in, quad-set-out) and reuses Comunica machinery that already lives in `core`. Keeping the algorithm in `core` opens a future CLI describe without an extraction step, at trivial cost.
- **Client-side fanout** (N parallel `/api/sparql/<id>` calls, merge in browser). Rejected: iterative bnode fixpoint needs multiple round-trips per source; doing N×rounds from the browser is slow and serialises poorly with the safety cap (the cap has to be enforced somewhere — moving it client-side is awkward). One server endpoint orchestrating is simpler.
- **Side-band provenance map** in the response (`{ quads, originBy: {quadKey: sourceId[]} }`). Considered seriously. Rejected at the user's call in grilling: RDF-star annotations on the wire keep the response self-describing as RDF, which leaves the door open to consumers that want to dump or pipe the raw stream. The renderer's strip pass produces an effectively identical UX, so the wire-format choice is independent of UX.
- **Constructed IRI for the provenance object** (`urn:sparqly:source:<id>` instead of a string literal). Rejected: source `@id`s are free-form config keys, not IRIs. Forcing them into a synthetic IRI scheme requires escaping and round-tripping for no observable gain (the renderer strips by predicate; the value is read as the `@id`).
- **Reuse `urn:sparqly:source` / `annotateSource` predicates.** Rejected hard: those record file authorship, not registry membership. Conflating the two would make `annotateSource`-using pipelines undistinguishable from describe-injected provenance, breaking the canonicalization-strip contract and the `diff`-surfaces-source-records contract.
- **Hijack the graph name to encode source `@id`** (e.g. `<urn:sparqly:source:foo>`). Rejected: destroys the real graph name the quad carried in its source. TriG files and endpoints with named graphs would lose their actual graph membership.
- **`0 sources selected ⇒ all sources`.** Rejected: dishonest semantics. The user's gesture of "deselect everything" must produce a visibly-empty result, otherwise toggling is non-monotonic.
- **No safety cap, fail on huge results.** Rejected: pathological bnode graphs would lock the page. A soft cap with a `truncated` flag and a configurable hard ceiling lets the deployment tune once and surfaces truncation clearly in the UI.
- **Fail the whole request on any per-source error.** Rejected: one slow endpoint should not blank the page. Per-source error map + 200-on-any-success matches the best-effort multi-origin intent.
- **Render the provenance annotations inline (no strip).** Rejected: provenance noise would dominate the actual data on every page; user-authored RDF-star annotations would get visually lost; the `urn:sparqly:fromSource` predicate would leak into the user-visible UX as a built-in vocabulary the user has to ignore.
- **Single ADR covering only the algorithm, separate ADR for the page and the provenance shape.** Rejected: the three decisions are tightly coupled — algorithm shape forces orchestration shape forces provenance shape — and reading them apart misses why each looks like it does. One ADR keeps the rationale connected.

Alternatives weighed for the **sectioned render** amendment:

- **Keep the flat by-subject table; add the sectioned view as a third tab.** Rejected: the flat table *is* the thing being replaced (showing the subject on every row is the noise the amendment removes), and `turtle`/`trig` already covers "I want the raw serialization." A third tab is clutter and a second renderer to maintain.
- **Three sections: outbound, inbound, and a "blank nodes" bucket** (every bnode-subject quad, flat, like today's groups). Rejected: the bnode bucket is just the old flat table again and severs the "this subtree hangs off the seed" reading. Nesting bnode subtrees under whichever direction reached them keeps the bounded-description story intact.
- **A both-ways blank node picks one home** (outbound wins). Rejected: rendering it in both sections matches how a Turtle serializer inlines a shared bnode at each reference site; a both-ways bnode is rare and seeing it on both sides is honest. Picking one side would hide a real edge.
- **Reuse `formatRdf`'s output to render the sections** (two `<pre>` blocks over the outbound/inbound sub-stores). Rejected: `formatRdf` emits an opaque string — you cannot decorate individual terms inside it with describe-this chips, source badges, graph chips, or the bnode-expand affordance, all of which the page needs inline. The renderer emits a structured view-model and reimplements the nesting heuristics in a light form; the cost is a small risk of drift from `formatRdf`, accepted because this is a different (interactive) surface.
- **Extract `detectLists` / `inlineSingleUseBlankNodes` from `formatter.ts` into shared `common` exports.** Considered. Rejected for v1: it's a refactor of stable code, and the two consumers want subtly different things (string emission vs. view-model tree), so the shared layer ends up thin. Revisit if a third consumer appears.
- **Render RDF-star annotations only in the `turtle` tab, not in the sections.** Rejected: they'd vanish from the default view. A nested `{| … |}` sub-block on the annotated row keeps them visible without a standalone `<<…>>` subject group.
- **A separate ADR for the sectioned render** (like ADR-0022 did for entity hunks). Rejected: this is a presentation reshape of an existing surface — no algorithm, orchestration, wire-shape, or config change — and ADR-0015 already owns "describe page UX." Amending it in place keeps the rationale in one place.

## Consequences

- **`libs/core`**: gains `describeStore` and `describeEndpoint` (two pure primitives), plus a small RDF-star annotation builder for `urn:sparqly:fromSource` (reusable as the renderer's strip predicate-match too). Both primitives are exported.
- **`libs/server`**: gains `DescribeService` and `DescribeController` (`POST /api/describe`). `GET /api/config` extended to return the `describe` block alongside `sources` and `context`.
- **Config schema**: new top-level `describe:` block with the three keys above; Zod schema in the config loader follows the **Context block** pattern (top-tier layer, no per-command opt-in).
- **Webapp**: gains a `/describe` route, an `app-describe-page` component, a Turtle-renderer extension for per-quad source badges, and a renderer-side strip pass keyed on the configured `fromSourcePredicate`. Header nav gains a "describe" link visible in both `serve` modes.
- **CONTEXT.md**: gains **Describe**, **Describe page**, **Describe provenance**, **Describe bnode rewrite**, **Describe response counts**, **Describe block**; new relationships covering `/api/describe`'s dispatch and the non-conflation with **Source records**.
- **Two RDF-star annotation systems**: documented side by side. Future readers wondering "why are there two" land on this ADR. Future predicate proposals must justify which axis (file authorship, registry membership, or new) they belong on.
- **ADR-0005 listing**: amended a second time (after ADR-0011) — `/api/describe` operates on `[0..n]` registry sources. The "single target source at command boundary" rule remains for `query`, `hash`, `diff` (CLI) and for `serve`'s Single-source mode; the carve-out continues to expand only in the long-running webapp surface.
- **Threat surface**: no new file-reading or SSRF beyond what `/api/sparql/<id>` already exposes. Per-source caps bound resource consumption; the hard ceiling prevents a request param from amplifying load.
- **Breaking change**: none. Existing config files without a `describe:` block use defaults.
