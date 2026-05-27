---
status: accepted
amends: 0030
---

# Source picker: history-aware pinning and commit-list affordance

## Context

ADR-0030 stood up the two-column source picker with ref discovery: a left column lists every registry entry, a right column lists branches/remote-tracking branches/tags for the highlighted glob. Two gaps surfaced once it landed.

**First**, the ref panel offers pinning UI for any source whose `from:` chain bottoms on a glob, regardless of whether that glob's matched pattern has ever been tracked in the repo. A glob declared on a `.gitignore`d directory, or on a file the user just created and hasn't committed, still presents a full list of refs to "pin" against — refs whose tree contains nothing for that pattern. Selecting one and applying it produces the existing empty-match warning (ADR-0028) at resolution time, far from where the user made the choice. The picker should answer "is there any point in pinning this glob?" up front.

**Second**, the ref panel exposes refs (branches, tags) but not the *commits along them that actually changed this glob*. The driving workflow is the inverse of the PR-review case ADR-0030 was built for: a maintainer wants to diff a single ontology file between two of *its own* commits — "show me when `vendor/foaf.ttl` was last touched, and let me pin to that revision (or the one before)." The closest workaround today is dropping to a terminal for `git log -- <path>` to harvest a SHA, then typing it into the picker's free-form input. That's the same papercut ADR-0030 closed for ref names; the same shape closes it for commits.

Both gaps share a single eligibility predicate (`git log --all --max-count=1 -- <pattern>` — does the pattern have any history at all?) and a single new panel section (a commits list). One ADR because the suppression rule and the commits affordance reshape the same surface and have to compose; splitting would force two grilling sessions over coupled trade-offs.

The `multi-sources-picker` on the describe page remains out of scope, consistent with ADR-0030's deferral.

## Decision

The single-source picker's ref panel gains:

1. A **history-eligibility check** that suppresses the panel when the glob/file has never been touched by any commit on any ref.
2. A new **Commits** section, peer to Branches/Remote/Tags, listing commits that touched the glob/file under a user-selectable scope, with row click pinning to the commit's full SHA.

Backed by:

- `GET /api/sources/:id/refs` extended with a new failure shape.
- A new `GET /api/sources/:id/commits` endpoint.

### Eligibility predicate

A glob/file is **pin-eligible** iff `git log --all --max-count=1 -- <pathspec>` returns at least one commit. This is the union of "tracked at HEAD" and "ever tracked on any ref" — the most permissive predicate that still rules out the truly-empty case (`.gitignore`d-and-never-committed, brand-new-and-never-staged, no-such-path-ever-existed).

The predicate runs server-side as part of `GET /api/sources/:id/refs` ahead of the existing `git for-each-ref` work; when it fails, the endpoint returns:

```
GET /api/sources/:id/refs
=> 404 { error: 'no-git-history' }
```

joining the existing `no-git-repo` and `pin-unsupported` failure shapes. The picker's `RefsPanelState` gains a matching `no-git-history` variant that renders an explanatory empty state in place of the section list. The free-form ref input stays hidden in this state (same posture as the existing `no-git-repo` branch — typing `HEAD~3` against a pattern with zero history is also empty).

`.gitignore`d vs untracked-but-not-ignored is not distinguished in the response or the UI. Both collapse to the same predicate result and the same user remedy (commit it, un-ignore it). Distinguishing would require an extra `git check-ignore` shell-out per panel open for cosmetic reason text.

### Commits endpoint

```
GET /api/sources/:id/commits?ref=<scope>&limit=<n>&before=<sha>
=>
{
  commits: Array<{
    sha:         '<40-hex>',
    shortSha:    '<7-hex>',
    subject:     '<first line of commit message>',
    authorName:  '<name>',
    authorDate:  '<ISO-8601>',
    parents:     Array<'<40-hex>'>,
  }>,
  nextBefore: '<40-hex>' | null,
}
```

Powered by `git log --format=...` against the resolved repo. Scope vocabulary:

- `HEAD` (default) — `git log HEAD -- <pathspec>`.
- Any ref string the picker would have shown in Branches/Remote/Tags — validated against the same `for-each-ref` listing the `/refs` endpoint returns.
- Sentinel `__all__` — `git log --all -- <pathspec>`.

Arbitrary SHAs are rejected as scope values (the scope is a *named* viewpoint, not "everything reachable from this commit"). Pathspec translation lives server-side: the glob's tinyglobby pattern is rewritten as `:(glob)<pattern>` for `git log`; **file source** children pass through as the resolved repo-relative path. Default `limit` is 50; pagination is cursor-based via `before` (the picker fetches the next page by passing the oldest SHA already seen). Failures (bad ref, repo I/O error) surface as typed HTTP errors; the picker renders inline.

Both endpoints reuse the existing `resolveRefsSource` walker — view's `from:` chain down, file's `parentId` up. The pin still bottoms on a single glob, and the pattern handed to git is that glob's pattern under the resolved repo root.

### Picker UI

```
┌──────────────────────────────────────────────────────────────┐
│ Source list   │ Refs for @docs/people/alice.ttl              │
│ (unchanged    │ Search refs…              [⟳ Refresh]        │
│  per ADR-0030)│ HEAD                                         │
│               │ Branches                                     │
│               │   main         abc1234                       │
│               │   feat/foo     def5678  ●                    │
│               │ Remote (origin)                              │
│               │   origin/main      ↑                         │
│               │ Tags                                         │
│               │   v1.2 (annotated)  ★                        │
│               │ ───────────────────────────────              │
│               │ Commits on: [ HEAD ▾ ]                       │
│               │   abc1234  Fix Alice's email     alice · 2d  │
│               │   9f2a710  Initial import        bob   · 6m  │
│               │   [ Show more ]                              │
│               │ ───────────────────────────────              │
│               │ Or type a ref: ____________________          │
│                                                              │
│                       [Cancel]  [Apply]                      │
└──────────────────────────────────────────────────────────────┘
```

The Commits section sits beneath Tags as a peer, not a tab. Branches/Remote/Tags remain unchanged from ADR-0030 — selecting them still pins to the ref string verbatim, including the existing reproducibility markers.

**Commits row format.** `[shortSha] <subject> · <author> · <relative date>`; the absolute timestamp surfaces on hover via `title=`. No branch decorations, no graph art — the scope selector already names the viewpoint, and per-row decorations would be noise at 50 rows.

**Scope selector.** A single dropdown labeled `Commits on:` with options `HEAD` (default), `__all__` (labeled "All refs"), and every ref name from the `/refs` response inline. Changing scope fires a fresh `/commits` request; cursor pagination resets.

**Row click pins to full 40-hex SHA.** The URL becomes `?source=@docs:<40-hex>`. The existing `/^[0-9a-f]{40}$/i` test in `sources-picker.component.ts` correctly classifies this as a reproducible **Pinned ref**, so the floating-ref banner does *not* render and the reproducibility marker lights up. Reasoning: clicking a commit row *is* the user choosing the SHA as the user-facing ref string — the same logic that kept ADR-0030 from baking SHAs into URLs for branch pins (preserve the user-typed string in `sparqly:gitRef`) cuts the other way here.

**Empty-scope state.** When the eligibility predicate passed but the *current scope* has zero commits (e.g., scope=HEAD but the file lives only on a branch), the section renders inline: *"No commits on `HEAD` touched this glob. Try scope: all refs."* with "all refs" as a clickable affordance that flips the scope selector. Because the eligibility predicate uses `git log --all`, an eligibility-passing glob *always* has commits under the `__all__` scope, so the suggestion always succeeds.

### Caching

No server-side cache, same posture as ADR-0030 for refs. `git log --max-count=50` is single-digit milliseconds on cold cache even on large repos; pagination cursors make re-fetches cheap.

The picker's existing per-overlay-session client cache extends to commits: `Map<sourceId + scope, CommitsPage[]>` for the life of the open overlay. Switching scope re-fetches (no client-side filter); switching sources clears the relevant entries.

### Trust boundary

Unchanged in shape from ADR-0030. The `/commits` endpoint exposes commit SHAs, subjects, author names, and dates from the host repo to any reachable HTTP client. `serve`'s "not safe to expose on a public port" caveat is unchanged; this ADR widens what's leaked along the existing perimeter.

### Out of scope, deferred

- **`multi-sources-picker` on the describe page.** Same deferral as ADR-0030. Users who know a commit SHA can still pin via the URL `sources` param.
- **Diff-page coordination between the two pickers.** No "the other side is pinned to abc1234" hint, no shared commits cache, no "duplicate to other side" affordance. ADR-0030's rejection of "pin all selected sources to the same ref" applies here.
- **Per-author / per-date-range / in-message search inside the commits list.** Solvable with the scope selector + scroll + browser find-in-page; revisit if it bites.
- **Per-ref annotations** ("this branch's tree does not contain the glob") on the Branches/Remote/Tags sections. Would require N ls-tree calls per panel open. The existing empty-match warning at resolution time covers the failure mode.

## Considered alternatives

- **Suppress the ref panel when the glob is "not tracked at HEAD."** Stricter predicate; cleaner empty-state story (no need for the empty-scope hint). Rejected: kills the "compare the same glob between two branches" workflow when one of the branches is the user's working branch and HEAD happens to have deleted the file. The permissive `git log --all` predicate keeps that workflow alive at no extra cost (the `git log` already runs to populate the commits section).

- **Predicate as opt-in toggle ("Show all refs anyway").** Default to suppressing at "not tracked at HEAD"; let the user click to widen. Rejected after grilling: redundant once branches/tags are always shown and the commits section makes "I want to pick a revision where this file existed" a first-class affordance. The toggle would expose machinery the user no longer has a reason to flip.

- **Distinguish `.gitignore`d vs untracked-but-not-ignored in the response and UI.** Better reason text. Rejected: extra `git check-ignore` shell-out per panel open, and the user's fix is the same either way. The single "no git history" message is precise enough.

- **Per-ref "does this ref's tree contain the glob?" annotations.** Dim or tag branches whose tree is empty for this pattern. Rejected for v1: N extra `git ls-tree --name-only <ref> -- <pathspec>` calls per panel open; the existing empty-match warning catches the failure at resolution time. Add later if user reports navigating to "wrong" branches.

- **One fat endpoint that bundles eligibility + refs + first page of commits.** Single round-trip per panel open. Rejected: pays the commits cost on every open even when the user never opens the commits section, and re-scoping commits to a different ref needs a second endpoint anyway. The two-endpoint split lets `/refs` stay cheap and `/commits` carry its own lazy/paginated lifecycle.

- **Three endpoints: separate `/eligibility`, `/refs`, `/commits`.** Cleanest separation of concerns. Rejected as over-decomposed: eligibility is on the critical path of rendering the panel, so it's already paid for on every `/refs` call; pulling it into its own endpoint adds a round-trip with nothing to show for it.

- **Click a commit → pin to short SHA `abc1234`.** Prettier URL; preserves "what the user actually clicked." Rejected: short SHA fails the existing 40-hex test for reproducibility classification, and widening that test to "short hex" collides with valid branch names like `abcdef`. Full SHA preserves the reproducible-ref contract that the user's click intent already implies.

- **Commits as a tab inside the ref panel** (Refs | Commits). Rejected: tabs hide content behind a click and break the user flow of "I'm browsing refs, and I also want to see commits along this branch." Stacked sections keep both visible.

- **Branch click filters the commits section to "commits on this ref."** Couples ref *selection* (pin) with commits *scope* (view). Rejected: click ambiguity (does clicking `main` stage a pin or change scope?). The independent scope selector under the Commits section gives the same outcome without the overload.

- **Cursor pagination by offset (`offset=<n>`).** Simpler client logic. Rejected: any interleaving call (a `git fetch`, a new commit) shifts the offset; SHA-based cursors are git-native and stable.

- **Server-side cache of `/commits` results.** Even a 5-second TTL. Rejected for the same reasons ADR-0030 rejected it for `/refs`: `git log` is millisecond-cheap, and the cache invalidation surface (new commits on the user's working branch) costs more than it buys. Client-side per-overlay-session cache covers the only realistic hot path.

- **Inline commit search/filter UI (author, date, message).** Rejected for v1: the scope selector plus scroll-and-find-in-page covers the common cases; adding three filter controls per panel inflates the surface for marginal benefit. Revisit if reported.

## Consequences

- **`GET /api/sources/:id/refs` gains the eligibility check** ahead of `git for-each-ref`. The check is a single `git log --all --max-count=1 -- <pathspec>` shell-out; failing returns `404 { error: 'no-git-history' }`. The existing `no-git-repo` and `pin-unsupported` shapes are unchanged.
- **New endpoint `GET /api/sources/:id/commits`** in `libs/server`, backed by `git log --format=...` against the resolved repo. Accepts `ref` (named ref or `__all__`, default `HEAD`), `limit` (default 50), and `before` (cursor SHA). Same `resolveRefsSource` walker as `/refs`.
- **Pathspec translation lives in `libs/server`.** Glob patterns are rewritten as `:(glob)<pattern>`; file-source children pass through as a resolved repo-relative path. Pattern translation is shared between `/refs`'s eligibility check and `/commits`'s log call.
- **`RefsPanelState` gains a `no-git-history` variant** in `apps/web/src/app/modules/sources-picker/refs-panel.component.ts`; the panel renders the explanatory empty state with the free-form input hidden, mirroring the existing `no-git-repo` branch.
- **New `commits-panel.component.ts`** sibling under `apps/web/src/app/modules/sources-picker/`, owning the Commits section: header (scope selector + Show more), row template (`[shortSha] subject · author · relative date`), empty-scope hint, click→full-SHA emit. Per ADR-0013 the component is feature-folder-scoped; per ADR-0026 the soft 300-line file budget applies.
- **`RefsApiClient` gains a `loadCommits(id, { scope, before, limit })` method** mirroring the existing `load(id)` shape, with the same per-overlay-session client cache pattern.
- **`sources-picker-overlay.component.ts` orchestrates the two sections.** The right column composes `<app-refs-panel>` and `<app-commits-panel>` stacked; both observe the staged source id and reset on focus change. The free-form ref input lives at the bottom of the right column, owned by the overlay (not by either child panel) so both sections render above it consistently.
- **Click→full-SHA pin** flows through the existing `applied.emit(`@${id}:${ref}`)` path in `sources-picker-overlay.component.ts`; the existing `isFloatingRefShape` check in `sources-picker.component.ts:174` correctly suppresses the floating-ref banner for 40-hex refs without modification.
- **No CONTEXT.md changes.** The eligibility predicate is implementation machinery, not a domain concept. The existing **Pinned source**, **Pinned ref**, **Floating ref**, **Glob source**, **Split glob**, and **File source** vocabulary covers every concept this ADR touches.
- **No CLI surface.** This ADR is webapp-only. The CLI's `--at` / `--left-ref` / `--right-ref` flags (ADR-0029) remain free-form ref strings; CLI users already have `git log -- <path>` in the same shell and don't need an in-process discovery affordance.
- **Trust boundary widens along the existing perimeter.** Commit SHAs, subjects, author names, and dates are exposed to any reachable HTTP client. `serve`'s "not safe on a public port" caveat is unchanged in shape.
- **ADR-0030 amended (not superseded).** The two-column overlay, source-list semantics, ref-listing endpoint, on-demand fetch, URL state via `@id:ref`, and `multi-sources-picker` deferral all stand. This ADR adds the eligibility check to the same `/refs` endpoint, introduces a peer endpoint for commits, and adds one section to the right column.
