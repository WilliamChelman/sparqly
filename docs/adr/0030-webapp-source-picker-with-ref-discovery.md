---
status: accepted
amends: 0011, 0029
---

# Webapp source picker with ref discovery

## Context

ADR-0029 made git revisions a first-class scoping axis on **Glob source** resolution and ADR-0027 split a glob into per-file children. Together these have inflated what the webapp's source picker has to handle: a registry that used to be "a handful of named sources" can now hold hundreds of split-glob children, each potentially pinnable to any ref in the glob's repo. The current `sources-picker` is a CDK Listbox dropdown — no text search, and while it accepts an `@id:ref` value via the URL (#279), it has no UI for *setting* a ref. The only way to pin from the webapp today is to hand-edit the URL.

This ADR specifies the webapp surface for **discovering sources by name** and **discovering and selecting refs per source**. The driving use case for the ref half is PR review: a maintainer lands on the diff page and wants to compare two branches that exist on `origin` without first dropping to a terminal to `git checkout` either.

Three concerns force a single ADR rather than three:

1. **Scale of the source list.** With split-glob expansion a single declared glob can become 200+ registry entries; a dropdown is the wrong primitive.
2. **A new server-side API surface.** Listing refs per source is a new server responsibility with operational decisions (caching, fetch behaviour, trust boundary) that outlive any one picker iteration.
3. **Discoverability of remote-tracking branches.** Surfacing `origin/*` is what makes the PR-review use case work, but it forces a fetch-policy decision the picker design has to commit to.

The `multi-sources-picker` on the describe page is *out of scope* for this ADR. It has its own selection model (many sources at once, potentially across different repos) that interacts with ref-pinning in ways that warrant a separate grilling. Describe-page ref pinning continues to ride on `@id:ref` in the existing `sources` URL param; no UI affordance is added there in this iteration.

## Decision

A new shared overlay component replaces the CDK Listbox dropdown inside `sources-picker`. The picker's trigger button is unchanged. Clicking it opens a modal with two columns: source list (left) with text search, ref panel (right) for the highlighted source. Apply navigates to the page's URL params with the combined `@id:ref` string; Cancel reverts.

Backed by two new endpoints in `libs/server`:

- `GET /api/sources/:id/refs` — lists the refs in the source's git repo.
- `POST /api/sources/:id/refs/fetch` — runs `git fetch` against the source's repo, then re-lists.

### Server endpoint shape

```
GET /api/sources/:id/refs
=>
{
  head:           { ref: 'HEAD',         sha: '<40-hex>', kind: 'head' },
  branches:       Array<{ ref: '<name>', sha: '<40-hex>', kind: 'branch' }>,
  remoteBranches: Array<{ ref: '<remote>/<name>', sha: '<40-hex>',
                          kind: 'remote-branch' | 'remote-head',
                          remote: '<remote>' }>,
  tags:           Array<{ ref: '<name>', sha: '<40-hex>',
                          kind: 'tag-annotated' | 'tag-lightweight' }>
}
```

The `kind` discriminator carries the **Pinned ref / Floating ref** distinction from CONTEXT.md to the wire: `tag-annotated` and full-SHA-shaped `branch` rows are reproducible; everything else is floating. This is what the picker uses to render a "reproducible" marker on rows.

For source kinds with no associated git repo (`endpoint`, `empty`, plus any `view` whose `from:` chain bottoms on one of those):

```
GET /api/sources/:id/refs
=> 404 { error: 'no-git-repo', kind: '<sourceKind>' }
```

For `view` sources, the endpoint walks the `from:` chain until it reaches a glob, and returns that glob's refs. This matches the existing pin-propagation rule (ADR-0029): when a user pins `@my-view:v1.2`, the pin is for the underlying glob, so the listing comes from there too.

`POST /api/sources/:id/refs/fetch` returns the same shape as the GET after running `git fetch` in the source's repo. Failure modes (network, auth) surface as HTTP errors with a typed body; the picker renders the failure inline in the ref panel and leaves the previous list in place.

### Refs are not cached server-side

`git for-each-ref` is millisecond-cheap even at thousands of refs. The server shells out per GET; no server-side cache. Floating-ref correctness wins over a marginal latency saving, and the cache invalidation surface (local commits move branch tips; that has to invalidate the cached entry per source) is avoided entirely.

The picker keeps a `Map<sourceId, RefsResponse>` in its own state for the duration of an open overlay session. Switching focus between rows in the same session is instant; closing and reopening the overlay re-fetches. Refresh-remotes invalidates the client cache for that source only.

### Remote-tracking branches are included; fetch is on-demand

Both halves of this decision are forced by the PR-review use case and the realities of running `serve` as a developer-local process.

- **Included.** `refs/remotes/<remote>/*` is enumerated alongside local branches under `remoteBranches[]`, with `remote` carried per entry. Multi-remote repos (`origin` + `upstream`) are common in fork workflows; the picker groups by `remote` in the UI when more than one is present. `refs/remotes/<remote>/HEAD` surfaces as `remote-head`. PR refs (`refs/remotes/origin/pr/*` etc., when the user has the fetch line configured) are surfaced as-is without special casing.
- **On-demand fetch.** No auto-fetch on every refs GET — picker dropdowns must not be I/O-bound on the network, and sparqly's typical deployment is developer-local where the user's git auth context is in scope (SSH agent, gh credentials) and surprise network traffic is unwanted. The picker shows what's locally known; a "⟳ Refresh remotes" button in the ref panel header invokes the POST endpoint to bring remote-tracking state up to date.

### Trust boundary

The ref-listing endpoint inherits the existing `/api/sparql` trust posture: it exposes information about the host repo (branch names, commit SHAs, remote names) to anyone who can reach the HTTP port. `serve` is not safe to expose on a public port — same as before — and ref listing does not change that perimeter, only widens what's leaked along the existing one.

### Picker UI: two-column overlay

```
┌─────────────────────────────────────────────────────────────────┐
│  Search sources…              │  Refs for @docs                 │
│ ──────────────────────────── │  Search refs…   [⟳ Refresh]     │
│  ▸ @docs (split glob, 247)    │  HEAD                           │
│    @docs/people/alice.ttl     │  Branches                       │
│    @docs/people/bob.ttl       │    main         abc1234         │
│  ▾ @endpoints/wikidata        │    feat/foo     def5678  ●      │
│    @views/people-summary  pin │  Remote (origin)                │
│  …                            │    origin/main      ↑           │
│                               │  Tags                           │
│                               │    v1.2 (annotated)  ★          │
│                               │    v1.1 (lightweight)           │
│                               │ ────────────                    │
│                               │  Or type a ref: HEAD~3          │
│                                                                 │
│                          [Cancel]  [Apply]                      │
└─────────────────────────────────────────────────────────────────┘
```

**Source list (left)**:

- Text search: case-insensitive substring over `id + label` of every `SourceListingEntry`. The matched substring is bolded inline.
- Hierarchy: parent groups are preserved; a group auto-expands when any of its children matches; non-matching siblings are dimmed rather than hidden, to preserve the structural cue that a child belongs to a split glob.
- Clicking a row selects it (single-select) and shows its refs in the right column. Selection is staged — not committed to URL until Apply.

**Ref panel (right)**:

- Sections rendered in order: `HEAD`, `Branches`, `Remote (<remote>)` (one section per remote when more than one is present), `Tags`. Sections with zero matches are hidden when searching.
- Per-row affordances: ref name; resolved SHA shown after the name in light text on floating-kind rows (`main  abc1234`); a ★ marker on `tag-annotated` rows and on rows whose `ref` is a full 40-hex SHA (the "reproducible" set).
- Ref search: case-insensitive substring over ref name + SHA prefix when the query is ≥4 hex chars. The latter is a reverse-lookup affordance ("which branch/tag points at `abc1234`?") that the picker would otherwise be missing.
- Free-form input: the search input doubles as a free-form ref field — pressing Enter applies the typed value verbatim if no list row is focused, accepting values like `HEAD~3` or raw SHAs that are not on any branch tip.
- Empty-repo / non-glob row focused: the right pane renders "No git refs available for this source" naming the source kind; free-form input is hidden.
- Sort order during search: by `kind` priority (`head` → `branch` → `remote-branch` → `tag-annotated` → `tag-lightweight`), then alphabetical within section. This puts the most-load-bearing match first for the PR-review case (`main` matches the local `main` branch before any tag containing the substring).

### URL state: combined `@id:ref`

Apply navigates with the picker's emitted value placed verbatim into the page's existing URL param: `source` for query, `left` / `right` for diff. The picker emits a bare `@id` when no ref is set, and `@id:ref` when one is. No new URL params (no `leftRef` / `rightRef`); the CLI's per-side flag form (`--left-ref` from ADR-0029) is a CLI-grammar accommodation that does not translate to URLs.

`Cancel` reverts to whatever was active before opening the overlay. No draft state persists across overlay sessions.

### Out of scope, deferred

- **`multi-sources-picker` on the describe page.** The selection model (many sources, potentially cross-repo) interacts with ref-pinning in ways that warrant a separate grilling. Ref-pinning continues to work via `@id:ref` strings in the existing `sources` URL param.
- **"Pin all selected sources to the same ref"** shortcut. Meaningless across repos; revisit if a real shared-repo describe workflow shows up.
- **Branch/tag creation, deletion, push.** This is a *picker*, not a git client.
- **GitHub-aware PR enumeration.** The picker shows what `git for-each-ref` knows about; it does not call the GitHub API to enumerate open PRs. If the user has the standard fork-fetch line configured, PR refs land in `remoteBranches` automatically.

## Considered alternatives

- **Free-form ref text input only.** No listing endpoint, single text field for the ref. Rejected: the user explicitly chose discoverability, and the PR-review workflow is built around "I don't remember the branch name" — exactly what listing addresses. The free-form fallback survives as an input mode for `HEAD~n` and raw SHAs not on any tip.
- **List branches and tags but exclude remote-tracking.** The minimal scope. Rejected: kills the PR-review use case, which is the load-bearing motivation for the ref half of this work.
- **Auto-fetch on every refs GET.** Always-fresh remotes. Rejected: turns picker focus into network I/O, leaks the user's auth context into every dropdown open, and surprises users on slow connections. On-demand refresh is the right granularity.
- **Scheduled background fetch.** Server periodically `git fetch`es. Rejected for v1: adds a config knob, a daemon-shaped concern, and auth-failure handling for a feature that is well served by an explicit button. Revisit if `everlasting` deployments make this load-bearing.
- **Server-side cache of `/api/sources/:id/refs`.** Even a 5-second TTL. Rejected: `git for-each-ref` is millis; the cache invalidation surface (local commits move branch tips per-source) costs more than it buys. Client-side per-overlay-session cache covers the only realistic hot path.
- **Split URL params (`leftRef` / `rightRef`).** Mirrors the CLI flag form. Rejected: the picker already emits `@id:ref` (#279 wired this in for the query page); splitting on diff would mean two URL conventions across query and diff pages and let `source` and `ref` drift in URL state. The CLI's flag form is a flag-grammar accommodation, not a model-level distinction.
- **Modal-over-modal: ref picker stacked on source picker.** Two scroll contexts, two close affordances, two escape semantics. Rejected — two-column master-detail is the same surface count with no stacking.
- **Inline ref-per-row** (each source row in the left column expands to show its refs). Rejected: at 247 split-glob children, vertical layout breaks down; per-row lazy refs fetch is also wrong to trigger on scroll. Two-column lazy-fetches on row focus exactly once per source per overlay session.
- **Two-step wizard (pick source → pick ref).** Rejected: forces backtracking when the user wants to adjust the ref after seeing what's available. Two-column gives a stable spatial model: left is *which*, right is *at what revision*.
- **Combined endpoint that returns refs for all sources at once.** Rejected: each glob discovers its own repo, so refs are not a registry-wide concept. Per-source endpoint keeps the cache key clean and lets a slow or unauthenticated repo fail in isolation rather than failing the whole picker.
- **Bake the resolved SHA into the URL** (`@id:abc1234` instead of `@id:main`). Rejected: discards the user-facing ref string that **Source records** carry in `sparqly:gitRef`; PR-review URLs become opaque hex; "this is `main` at fetch time" becomes uninspectable from the URL.
- **Fuzzy search over source ids.** Rejected for v1: ids are structured (`@parent/path/file.ttl`); substring matches the way users actually search (typing `alice` to find `@docs/people/alice.ttl`). Fuzzy is a one-line swap later if marginal cases show up.

## Consequences

- **New endpoint `GET /api/sources/:id/refs`** in `libs/server`, backed by `git for-each-ref` over each source's resolved repo root. View ids walk the `from:` chain (re-using ADR-0029's pin-propagation walker); chain bottoming on `endpoint` or `empty` returns 404 with the typed body.
- **New endpoint `POST /api/sources/:id/refs/fetch`** in `libs/server`, runs `git fetch` against the source's repo, returns the same shape as the GET on success. Failures surface as typed HTTP errors and do not poison the existing client-side cache for that source.
- **New shared overlay component** under `apps/web/src/app/modules/sources-picker/` (sibling to the existing `sources-picker.component.ts`). Per ADR-0013 the component is feature-folder-scoped; per ADR-0026 the file-size budget applies and the right-pane ref-list rendering moves to its own sibling if the overlay file approaches the soft 300-line cap.
- **`sources-picker.component.ts` is restructured around the overlay** but keeps its existing public API: a single bound value that may be `@id` or `@id:ref`, and a `valueChange` event emitting the same. URL-state code on the query and diff pages stays put.
- **The existing CDK Listbox dropdown is removed.** The trigger button is unchanged; what it opens is.
- **No change to `/api/config`'s `SourceListingEntry` shape.** Ref state is per-source and lazy; it is not pre-bundled into the registry listing. This keeps the listing endpoint cheap and avoids coupling registry listing to git operations.
- **Pinned-ref classification is computed server-side**, not in the picker, via the `kind` discriminator. The picker has no need to ship `resolveGitRef`-equivalent logic, and the two clients of the classification (this picker and any future one) stay consistent.
- **Trust boundary is unchanged but the surface grows.** The new endpoints expose ref names, commit SHAs, and remote names of the host repo to any reachable HTTP client. `serve`'s "not safe on a public port" caveat is unchanged in shape; this ADR widens what's leaked along the existing perimeter.
- **`multi-sources-picker` is untouched.** Describe-page ref pinning continues to ride on `@id:ref` strings in the existing `sources` URL param. A follow-up ADR will grill multi-select ref-pinning semantics in their own right.
- **CONTEXT.md unchanged.** This is a UI surface for established concepts; no new domain terms emerge. `Pinned source`, `Pinned ref`, `Floating ref` are authoritative and already name the picker URL as a place pins originate (ADR-0029).
