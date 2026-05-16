---
status: accepted
amends: 0015, 0019
---

# Single-or-all describe with split-glob children absorbed by the meta

## Context

ADR-0015 framed `/api/describe` as a fan-out across N selected sources, with `sources?: ReadonlyArray<string>` on the request and `perSource: Record<id, …>` on the response. ADR-0027 then added **File source** children — synthesized peers of every `splitByFile: true` glob, present in the served registry alongside their parent meta. The two ADRs were written in the right order but never explicitly composed: `DescribeService.selectSources` iterates `this.servedRegistry` and accepts every `glob | file | endpoint | view | empty | reference` entry whose id matches the request's `sources` filter (or, when the filter is omitted, every supported kind). For a split glob `@docs` matching N files, that means a cold describe with no `sources` field runs the full bnode-fixpoint **N+1 times** — once on the meta union, once per child — for zero new information in the merged result.

Two costs compound the waste:

1. **`describeStore` runs to fixpoint per call.** The meta's combined store and each child's one-file store each walk the seed's bnode closure independently. The shared **engine map** memoizes the *load* of each file, but not the describe traversal.
2. **`relabelBnodes(quads, id)` defeats lexical dedup on bnode subtrees.** Every source's bnode labels are rewritten with that source's `@id` as a prefix, so the same logical bnode loaded twice (once via meta, once via child) becomes `_:docs__x` and `_:docs/alice.ttl__x`. `assembleResult`'s `(s,p,o,g)` Map keys lexically and keeps both copies. The merged result acquires duplicate subtrees scaling with the number of split-glob children — the larger the split, the worse.

The multi-id filter axis is also poorly justified on its own merits. The webapp picker is the only first-class consumer; the CLI does not call describe. The picker's two natural modes are "merged view of everything I've configured" and "just this one source, please" — there is no real user flow that picks an arbitrary subset. The wire shape `sources?: string[]` exists because ADR-0015 left room for it, not because any caller needs it.

## Decision

**Request shape collapses from `sources?: string[]` to `source?: string`.** Omitted means "all available"; given means "exactly this one." Naming multiple sources is no longer expressible.

**"All available" excludes split-glob children whose parent meta is also served.** The filter lives in `DescribeService.selectSources` and applies only to the no-`source` branch:

- Drop every `kind: 'file'` source whose `parentId` appears as the id of a served entry.
- Drop every `kind: 'empty'` source (a no-op contributor under the new contract — see below).
- `kind: 'reference'` is already excluded earlier in `resolveServeScopeResult.candidates`; the filter does not need to repeat that.

A child remains targetable as an explicit `source: '@docs/foo.ttl'` — the absorption rule only governs the implicit fan-out.

**Explicit `source` honours the named id literally.** No absorption, no auto-expansion. `source: '@docs'` runs only the meta; `source: '@docs/foo.ttl'` runs only that one child; `source: '@empty-thing'` returns the existing `empty-source` per-source error; `source: '@unknown'` returns the existing `empty-target` precondition error. The `@id:ref` git-pinning syntax (ADR-0029, ADR-0030) flows through unchanged.

**`expandedPaths` collapses from `Record<id, PathStep[][]>` to `PathStep[][]`.** Valid only when `source` is set and that source is `kind: 'endpoint'`. Supplying `expandedPaths` without `source`, or with a `source` of any other kind, is a 400 precondition violation. Materialized sources continue to ignore the field (they are already fully expanded); the difference is that the request now never carries paths for them in the first place.

**Response shape keeps `perSource: Record<id, …>`** even when the request named a single source. With `source` set, the record has exactly one entry; with `source` omitted, one entry per source that participated in the fan-out. The all-failed top-level error from ADR-0025 still fires when every fanned-out source erred; with a single `source`, the all-failed case collapses to that one source's error promoted to the top level.

**Webapp describe page swaps `multi-sources-picker` for the existing `sources-picker`.** The single-source picker already handles `@id:ref` git-pin syntax (ADR-0030) and a cleared selection. Cleared selection maps to "no `source` field" on the wire, i.e. the merged view across every absorbed-meta entry. The describe page's old "Select all" / zero-selected empty-state affordances are deleted along with the multi-select control.

## Considered alternatives

- **Keep `sources?: string[]`, dedup children post-hoc inside `assembleResult`.** Attractive because the wire shape stays additive and the picker UI does not change. Rejected: the duplicate fixpoint work is still paid (you traverse before you dedup), the bnode-rewrite dedup hole is structural (you would have to either remove the relabelling, which kills cross-source bnode isolation, or post-process bnode trees pairwise, which is an ad-hoc reverse of the rewrite). Fixing the wire shape removes the class of bugs; fixing only the post-merge dedup leaves the cost class intact.

- **Add a `describable: false` marker on synthesized File children.** Declarative, lets any consumer that wants the same "meta absorbs children" rule iterate the same flag. Rejected as speculative: describe is the only consumer that wants the rule today; other consumers (`/api/sparql/<id>`, `/api/config`, snippet allow-list, picker enumeration) all need children visible as first-class queryable ids. Adding a flag that exactly one consumer reads is YAGNI; promote the rule when a second consumer appears.

- **Keep multi-id support but treat `sources: ['@docs', '@docs/foo.ttl']` as a request-validation error.** Forces the caller to pick a granularity without changing the shape. Rejected: the validation rule ("you cannot name a meta and any of its children together") is one more line of contract for callers to learn, the picker still has to enforce it, and the underlying observation — that nobody actually wants per-id-subset describe — is left unaddressed.

- **Move endpoint path expansion to a separate `/api/describe/expand` route.** Decouples the cold-describe and pull-this-bnode flows. Rejected: ADR-0019 deliberately fused them onto one request shape so the response is a pure function of the inputs and no server state is required between "cold" and "deeper" calls. Splitting the route would re-introduce request-shape variance (two endpoints, two request types, two response merges in the client) for no callsite win.

- **Default to "the registry's default-marked source" rather than "all."** Parallels `/api/sparql`'s unparameterized route. Rejected: the headline UX of the describe page is the merged view across every source. Falling back to one source by default forces the webapp to send the explicit list of all ids on every cold landing — which re-introduces the multi-id wire shape we just removed.

- **Reject the request when the registry has ≥ 2 sources and `source` is omitted.** Zero ambiguity, no hidden fan-out. Rejected for the same reason: the landing experience of "open the describe page, see merged result" becomes a two-click flow.

- **Always surface `empty-source` as a per-source error under "all."** Maximally transparent. Rejected: an `empty` source is empty by construction, not by runtime failure. Showing it in `perSource` on every cold describe is noise. The explanatory error is still available via explicit `source: '@empty-thing'`, where the user has signalled they want to know.

## Consequences

- **Wire shape break (no compatibility shim).** `DescribeRequest.sources` becomes `DescribeRequest.source`; `DescribeRequest.expandedPaths` changes type. Clients on the old shape get a parse failure at the request boundary. Pre-1.0 — acceptable.

- **ADR-0015 amended, not superseded.** The per-source merge mechanics (`originsByQuad`, dedup, `perSource` membership counts), the multi-origin best-effort posture from ADR-0025, and the **describe-bnode-rewrite** disjointness all remain. What changes is the *set* of sources fanned out: now driven by the absorbing-meta rule under "all" mode, never by a caller-supplied filter list.

- **ADR-0019 amended.** `expandedPaths` no longer needs a per-source keying — by construction it now applies to exactly one endpoint source per request. The `MAX_EXPANSION_PATH_STEPS = 12` cap and `truncated` flag are unchanged.

- **`selectSources` filter lives once, in `describe.service.ts`.** Other consumers of the served registry (`/api/sparql/<id>`, `/api/config`, snippet allow-list, the watcher, the picker enumeration endpoint) keep iterating the canonical flat registry — children remain first-class queryable everywhere else.

- **`describe.controller.ts` and the OpenAPI / Zod request schemas need shape updates.** `sources: string[]` → `source: string | undefined`; `expandedPaths: Record<…>` → `expandedPaths: PathStep[][] | undefined`. The 400 path validates the `expandedPaths` ↔ `source` coupling.

- **CONTEXT.md updates** when this ships: **Describe page** loses the "Initial state on first load selects all sources; zero sources selected produces an empty result with a 'Select all' affordance" sentence (replaced by single-or-cleared picker). **Describe expansion path** loses the "per source id" framing in favour of "per request, against the selected endpoint source." No new terms — the existing vocabulary still covers the surface.

- **Spec updates.** `describe.service.spec.ts` loses the multi-id selection cases and gains coverage for the absorbing-meta rule and the `expandedPaths`-without-`source` 400. `describe.controller.spec.ts` validates the new request shape. The webapp's `describe.page.spec.ts` swaps the multi-select picker harness for the single-select one.

- **Picker discoverability of "all".** The cleared-selection state is now the merged-view affordance. The page should label it explicitly (e.g. a placeholder "All sources" in the picker) so the entry point is obvious without a tooltip.
