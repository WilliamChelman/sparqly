# Git-pinned glob sources via `gitRef`

> **Status:** amended by [ADR-0032](0032-loader-attached-source-record-sidecar.md) — `gitRef` / `gitSha` populate directly into `SourceRecord` fields on the loader-attached sidecar; the RDF-star round-trip described below remains the explicit-opt-in projection authored by `annotateSource` for SPARQL queryability.

A user wants to query, hash, or diff an RDF source *as it existed at a specific git revision* — the reference version of an ontology pinned to a tag, the previous release of a vocabulary, the working tree at `HEAD~1` for a pre/post-migration audit. The workaround today is shell scripts that `git checkout`, run `sparqly`, and `git checkout -` back; this loses reproducibility (mid-run working-tree mutation), can't express "diff this glob between v1.2 and v1.3" cleanly, and doesn't compose into the webapp at all. This ADR makes a git revision a first-class scoping axis on **Glob source** resolution, parallel to (and independent of) the SPARQL-query scoping a **View** provides.

ADR-0027 already foresaw this — the rejected alternative "reuse `kind: 'glob'` for children" called out that "the future direction of versioning a single file at a git revision needs a real revision identity, not grafted onto a glob." This ADR delivers that, but at the **Glob source** level rather than introducing user-declared `kind: 'file'` (see below).

## Decision

### The new concept

- **Pinned source** — a **Glob source** resolved against a specific git revision. Synthesized at resolution time, never a registry entry. Composes with **split globs**: enumeration walks the *git tree at the resolved SHA* (not the working tree), and synthesized **File source** children inherit the pin.
- **Pinned ref** — full commit SHA or annotated tag. Frozen; reproducible across fetches.
- **Floating ref** — branch, `HEAD`, `HEAD~n`, or lightweight tag. Resolves at process start (CLI) / load time (server). Cache key is the resolved SHA, never the ref string, so a floating ref is *current at fetch time, not reproducible across fetches*.

### Where pins come from

A **Pinned source** can arise three ways, all desugaring to the same internal shape:

1. **Declared** — `gitRef:` field on a `kind: 'glob'` source in config.
2. **CLI** — `--at <ref>` on `query`/`hash`; `--left-ref <ref>` and `--right-ref <ref>` on `diff`.
3. **Address syntax** — `@<id>:<ref>` anywhere a source ref is accepted: CLI positionals, `view.from:`, the picker URL, `--source` on `serve`.

**Invocation-time pins always override declared `gitRef`.** A glob declared `gitRef: v1.2.0` and invoked as `@docs:v1.3` resolves at v1.3. Otherwise the diff-across-versions workflow would be impossible to express.

### Address syntax

`@<id>:<ref>`. Parser splits on the **last** `:` — whatever follows is the ref string; whatever precedes is the registry-resolvable id. Works uniformly for plain globs (`@docs:v1.2`) and split-glob children (`@docs/people/alice.ttl:v1.2`). The `:` delimiter is parser-safe: `SOURCE_ID_REGEX` doesn't permit `:`, glob syntax doesn't use it for paths, and split-glob children already use `/`. The split-glob child id remains `<parentId>/<path>` per ADR-0027; the SHA is **never** baked into the id, only into the address.

### Repo discovery

- **Default — implicit per-glob root.** Walk up from the *base* of the glob pattern (the directory portion before any wildcard) until a `.git` directory is found. That single repo is the resolution root for all matches.
- **Override — `gitRoot:` field on the glob.** Explicit path (relative to the project config) when the default doesn't apply: vendored ontology in a sibling repo, submodule, repo elsewhere on disk.
- **No repo found + `gitRef` declared → hard parse error.** Message: `gitRef requires a git repository — none found by walking up from <base>. Either move the glob inside a repo or set gitRoot:`.

### Resolution semantics

- File **content** comes from the git tree at the resolved SHA (`git show <SHA>:<repo-relative-path>` or equivalent). The working tree is irrelevant for pinned sources — even if a file exists on disk, its disk content is not consulted.
- File **enumeration** for `splitByFile: true` walks the git tree at the SHA, not the working tree. Files added after the ref are absent; files deleted after the ref are present. This is the only coherent answer.
- **Empty match warns** — same as a working-tree empty match (ADR-0028). Consistent UX.
- **Missing repo / unresolvable ref → hard error.** That's a config bug, not a data condition.

### Split-glob children + pinning

- Child id stays `<parentId>/<path>` (ADR-0027 unchanged). The pin lives in the address (`@<parentId>/<path>:<ref>`), never in the id.
- A pinned split-glob enumerates from the git tree at the SHA. The resulting children inherit the pin alongside the transform pipeline.
- Different pins of the same split glob are *different cache entries* (different resolved SHA in the upstream spec) but *the same registry id family*. The picker shows one entry; the address carries the variation.

### View pinning propagates down `from:`

`@my-view:v1.2` leaves the view's *query* unchanged and propagates the ref down the `from:` chain (recursing through intermediate views) until it reaches a glob. The pin applies to that glob.

- **Bottoming on an endpoint or empty source → hard error reported at expand time** (not lazily): "cannot pin `@my-view`: its upstream chain reaches a `kind: 'endpoint'` source `@triples`, which has no git revision."
- **Cross-source `SERVICE` clauses inside the query are not affected.** They reference endpoints by URL, not by `from:`, and remain unpinned. This is consistent with how composition works in CONTEXT.md: `from:` is the single in-band upstream; `SERVICE` is out-of-band.

### Cache keying

The **Result cache**'s `view.id + from + query + upstream-spec` shape (CONTEXT.md) extends naturally: the upstream spec for a pinned source includes the **resolved SHA**. No new cache machinery; existing strategies (`ttl`, `freshness`, `everlasting`) apply unchanged. Two requests pinned to the same resolved SHA share a cache entry even if one used a tag and the other a SHA-shaped ref.

### Source records gain git provenance

When the originating triple was loaded from a **Pinned source**, the **Source record** carries two additional predicates:

- `sparqly:gitRef` — the user-facing ref string (tag, branch, SHA-as-typed).
- `sparqly:gitSha` — the resolved SHA.

Both are present even for **Pinned ref** sources (the resolved SHA equals the typed SHA for a SHA-typed ref; for an annotated tag, the SHA is the dereferenced commit SHA). The `sparqly:file` IRI remains the *disk path the file would resolve to in the working tree*, even when content was fetched from the git tree — this keeps source-file snippets renderable when the working tree happens to match, and keeps the IRI human-meaningful as a path.

The diff `html` format and the webapp diff page render the ref + SHA pair next to existing per-quad source attribution; structured outputs (JSON) carry the new fields verbatim.

### Watcher and pinned sources are non-overlapping universes

Working-tree filesystem events **never** invalidate a pinned source's cache:

- A **pinned ref** is frozen — invalidation would be wrong.
- A **floating ref** resolves at process start / load time (see below) — invalidating mid-run on every save would silently break the "current at fetch time" guarantee.

Conversely, the file watcher's existing behaviour for *unpinned* split-glob children is unchanged.

### Floating-ref refresh: process restart in v1

Floating refs are resolved once — at process start for the CLI, at server boot for `serve`. There is no live refresh affordance in v1. To pick up a moved branch tip, restart the process.

A per-source UI refresh button (ui clicks → re-resolve `git rev-parse <ref>` → bust the result-cache rows whose upstream id matches → next request re-resolves) is a clear follow-up — but it adds non-trivial cache-by-source-id plumbing and a notification surface, and the lack of it is documented rather than papered over.

### `kind: 'file'` stays system-only

ADR-0027's invariant that `kind: 'file'` is *never* user-declared is preserved. The "reference ontology pinned to a tag" use case is fully served by a single-file glob with `gitRef:` declared:

```yaml
- id: foaf
  glob: 'vendor/foaf.ttl'
  gitRef: v1.2.0
```

User-declared `kind: 'file'` would be a separate ADR with its own motivation (the relevant candidate motivation — error-on-missing instead of warn-on-empty — is real but orthogonal to git pinning).

### Shape of the new spec

```yaml
sources:
  - id: docs
    glob: 'ontologies/**/*.ttl'
    splitByFile: true
    gitRef: v1.2.0          # optional; pins this glob (and its children) to v1.2.0
    gitRoot: ../vendor-onts  # optional; overrides per-glob-root discovery
    transforms:
      - graphName: forceAll

  - id: foaf
    glob: 'vendor/foaf.ttl'
    gitRef: v1.2.0
```

CLI examples:

```sh
sparqly query @docs --at HEAD~3
sparqly diff @docs --left-ref v1.2.0 --right-ref v1.3.0
sparqly diff @docs:v1.2.0 @docs:v1.3.0    # equivalent to the line above
sparqly hash @analytics-view --at v1.2.0  # view pin propagates down from:
```

## Considered alternatives

- **Single-tier ref vocabulary.** Treat every ref string the same. Rejected: collapsing pinned (SHA, annotated tag) and floating (branch, `HEAD`) under one term invites silent reproducibility breaks — a user pinning to `v1.2` thinking it's frozen has no way to know the maintainer pushed a moved lightweight tag. Naming the distinction lets ADRs, error messages, and UI state surface it.

- **Floating refs forbidden — pinned only.** Reject branches, `HEAD`, `HEAD~n`. Maximally reproducible. Rejected: the "diff this glob against `main` weekly" use case is real, and forcing users to script SHA resolution is an unnecessary papercut. The two-tier vocabulary lets us serve both.

- **Polling git refs from the FS watcher** (resolve floating refs on `.git/HEAD` change). Rejected: noise/value ratio is bad — `.git/` mutates on every commit, fetch, branch switch, `gc`. Mid-run cache invalidation also silently breaks the "current at load time" semantic. Per-source refresh button is the right shape for this and is a deferred follow-up.

- **Address syntax flag-only (`--at`, no `@id:ref`).** No new address grammar. Rejected: doesn't compose into `view.from:` (which takes a string), into picker URLs, or into `--source` on `serve`. Each surface would invent its own pinning knob, four divergent dialects.

- **Address-prefix syntax `@<id>@<ref>`.** Rejected: tags and branches contain `@` (`HEAD@{1}`, `origin/main`); `:` does not appear in our id regex, glob syntax, or anywhere else in source addresses, so it is unambiguous.

- **Per-match repo discovery** (walk up from each matched path, allow cross-repo if all resolve). Rejected: cross-repo errors become *deep* errors discovered during expansion with half-results in hand. Per-glob-root discovery fails fast at parse/expand time before any expensive work.

- **Always-explicit `gitRoot:`** (no implicit discovery). Rejected: papercut for the dominant case (the glob lives in the project's own repo). The hybrid "implicit default, explicit override" hits both ends.

- **Bake the resolved SHA into split-glob child ids** (`<parentId>/<path>@<sha>`). Rejected: breaks ADR-0027's stable-id guarantee. The same file at two refs would produce two registry ids; picker entries multiply, source records become noisy, error messages list near-duplicate ids. The pin lives in the *address*, not the id.

- **Make declared `gitRef` lock the source against invocation-time override.** Rejected: makes "diff v1.2 vs v1.3 of an ontology that has a default declared ref" impossible to express. Explicit invocation always wins; the pin actually used is logged.

- **Pin views by snapshot (resolve view query against a frozen result set).** Considered as an alternative to pin propagation. Rejected: the cache already produces this if a strategy is set, and the user's intent ("compare a derived dataset across two ontology versions") wants the *same query* against *different upstream content*, which is what propagation gives.

- **User-declared `kind: 'file'` with `gitRef:`.** Tempting because pinning sounds file-shaped. Rejected for *this* ADR: single-file globs cover the use case identically, and reversing ADR-0027's invariant deserves its own motivation and grilling. The candidate motivation (error-on-missing vs warn-on-empty) is real but orthogonal — it can be added later as its own ADR without touching pinning.

- **Live refresh for floating refs in v1.** Rejected for v1 only: the plumbing (cache invalidation by source id, server endpoint, picker affordance) is real work and the workaround (process restart) is acceptable while the feature is new. Documented as a known follow-up rather than a hidden gap.

## Consequences

- **`ParsedGlobSource` gains optional `gitRef?: string` and `gitRoot?: string`.** `parseSourceSpec` validates shape (string, non-empty); resolution to a SHA happens at expand/load time, not parse time.
- **`expandSplitGlobs` walks the git tree** when the meta has `gitRef:` set. Same `ReadonlyArray<ParsedFileSource>` output shape; child `path` becomes the repo-relative path expressed under the absolute repo root, and the file's *content* is sourced from git, not disk. The walker dependency is no longer just `tinyglobby`; a `git ls-tree`-style walker is injected alongside it.
- **`@id:ref` is a parser-level address form.** A new resolution helper splits on the last `:`, looks the id up in the expanded registry, and synthesizes a **Pinned source** wrapper with the ref attached. Every consumer of "registry-resolvable address" (CLI target resolution, `view.from:` parser, picker URL parser, `serve` route resolver) goes through this helper.
- **CLI flags added:** `--at` on `query`/`hash`; `--left-ref` / `--right-ref` on `diff`. Each desugars to address-form before target resolution.
- **`Source record` carries `sparqly:gitRef` and `sparqly:gitSha` for pinned sources.** Diff outputs that already render source attribution surface the new predicates; canonicalization continues to strip `sparqly:source`-rooted records before hashing.
- **Result cache key extends with the resolved SHA in the upstream spec.** Existing strategies (`ttl`, `freshness`, `everlasting`) apply unchanged. Two requests with different ref strings that resolve to the same SHA share a cache entry.
- **File watcher ignores pinned sources.** Implementation: pinned-source loads carry a flag the watcher consults before invalidating per-source caches. Unpinned-source watcher behaviour is byte-for-byte unchanged.
- **`expandSplitGlobs` and target resolution both gain a "git-resolution" failure mode.** Bad ref, missing repo, view-pin chain bottoming on endpoint/empty all surface as typed errors at expand time, not as opaque failures during loading.
- **Resolution mechanism is implementation, deliberately unspecified here.** Likely `git` CLI shell-out for v1 (no new dependencies, handles all ref grammar), with libgit2 / isomorphic-git evaluated if perf or ergonomics push back.
- **ADRs amended (not superseded):**
  - **ADR-0027** — split-glob expansion walks the git tree (not the working tree) when the meta carries `gitRef:`. Children's stable-id rule is unchanged; the pin lives in the address, not the id. The "future direction of versioning a single file at a git revision" foreseen in 0027's rejected alternative is realised here.
  - **ADR-0004** — `view.from:` continues to accept `@id`; values may now also be `@id:ref` for an inline pinned upstream.
  - **ADR-0005** — single-target rule unchanged. A pinned source is a single target. `diff @docs:v1.2 @docs:v1.3` is still one target per side.
  - **ADR-0006** — transforms apply to pinned sources unchanged; pin and pipeline both inherit to children together.
  - **ADR-0008** — auto source annotation applies to pinned glob targets uniformly. Source records on pinned-source triples carry `sparqly:gitRef` + `sparqly:gitSha` in addition to the existing fields.
  - **ADR-0028** — empty match at a ref warns, same as in the working tree. Missing repo or unresolvable ref is a hard error (config bug, not data condition).
