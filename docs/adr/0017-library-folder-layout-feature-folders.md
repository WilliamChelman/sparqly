---
status: accepted
---

# Library folder layout and feature-folder conventions

## Context

ADR-0013 restructured `apps/web/src/app/` along three top-level boundaries (`core/`, `modules/`, `pages/`) with codified suffix, barrel, and promotion rules. That ADR is scoped to the webapp — its three buckets answer Angular-specific questions ("is this a router target, a reusable component, or a singleton service?").

The rest of the codebase still lives in flat folders:

- **`libs/core/src/lib/`** — ~50 files at one level, with a 39-line `src/index.ts` that re-exports each module individually. There is no folder-level signal for which files belong to which feature (diff vs views vs sources vs describe vs the canonicalization primitives), even though CONTEXT.md already names those features explicitly. The barrel forces every contributor to scan the whole list to know what's public; placement decisions for new files default to "wherever the similar ones are."
- **`libs/server/src/lib/`** — ~12 files, controllers and services intermixed (`sparql.controller.ts`, `diff.controller.ts`, `diff.service.ts`, `describe.controller.ts`, `describe.service.ts`, `snippet.controller.ts`, …). Small today, but the NestJS feature-grouping that would be obvious (one folder per HTTP feature) is absent.
- **`apps/cli/src/app/runner/`** — ~20 files flat: config discovery, file loading, field mapping, merge logic, meta flags, the runner itself. Two or three sub-clusters are visible but unexpressed.
- **`libs/common/src/lib/`** (5 files) and **`libs/domain/src/lib/`** (1 file) are below the legibility threshold and out of scope.

The webapp's pattern translates, but not literally: a library has no router targets, so the third bucket from ADR-0013 (`pages/`) does not apply. The honest analog is **feature folders** — cohesive clusters that own their internals — plus a small **shared-primitives** bucket for things genuinely orthogonal to any one feature.

## Decision

Restructure `libs/core`, `libs/server`, and `apps/cli/src/app/runner/` along **feature folders** with per-folder barrels, and codify a promotion rule keyed on **orthogonality** rather than the mechanical "second consumer" rule from ADR-0013.

### `libs/core/src/lib/` — feature folders + `shared/`

```
libs/core/src/lib/
├── shared/
│   ├── index.ts
│   ├── parse-sparql-prefixes.ts (+spec)
│   └── env-substitute.ts (+spec)
├── canonical/
│   ├── index.ts
│   ├── canonicalize.ts (+spec)
│   ├── strip-annotations.ts (+spec)
│   └── immutability.ts (+spec)
├── engine/
│   ├── index.ts
│   ├── query-engine.ts (+spec, +federation.spec)
│   ├── rdf-loader.ts (+spec)
│   ├── rdf-file-parser.ts (+spec)
│   ├── endpoint-http.ts
│   └── endpoint-load.ts
├── sources/
│   ├── index.ts
│   ├── source-spec.ts (+spec)
│   ├── transform-spec.ts (+spec)
│   ├── transform-pipeline.ts (+spec)
│   ├── annotate-transform.ts (+spec)
│   ├── graph-name-transform.ts (+spec)
│   ├── source-record-builder.ts (+spec)
│   ├── source-path-display.ts (+spec)
│   ├── load-sources.ts (+spec)
│   ├── resolve-source.ts (+spec)
│   ├── resolve-source-references.ts (+spec)
│   └── with-auto-source-annotation.ts
├── views/
│   ├── index.ts
│   ├── view-query-validate.ts (+spec)
│   ├── view-resolver.ts (+spec)
│   ├── view-cache.ts (+spec)
│   ├── view-pass-through.ts (+spec)
│   ├── anonymous-view-builder.ts (+spec)
│   └── resolve-anonymous-select-bindings.ts (+spec)
├── describe/
│   ├── index.ts
│   ├── describe-store.ts (+spec)
│   ├── describe-endpoint.ts (+spec)
│   └── relabel-bnodes.ts (+spec)
├── target/
│   ├── index.ts
│   ├── select-target.ts (+spec)
│   └── resolve-serve-scope.ts (+spec)
└── diff/
    ├── index.ts
    ├── diff.ts (+spec)
    ├── group-rdf-diff-by-entity.ts (+spec, +golden.spec)
    ├── grouped-diff-formatter.ts (+spec)
    ├── html-diff-composer.ts (+spec, +golden.spec)
    ├── format-human-source-comment.ts (+spec)
    ├── compress-source-records.ts (+spec)
    ├── source-snippet-reader.ts (+spec)
    ├── tabular-diff.ts (+spec)
    ├── tabular-diff-formatter.ts (+spec)
    ├── tabular-row-key.ts (+spec)
    └── select-shape-detector.ts (+spec)
```

`test/` (fake-sparql-endpoint, store-backed-sparql-endpoint, turtle helpers) and `__fixtures__/` stay at `libs/core/src/lib/` root unchanged — they are test infrastructure, not modules.

The package barrel `libs/core/src/index.ts` collapses to one re-export per feature folder:

```ts
export * from './lib/shared';
export * from './lib/canonical';
export * from './lib/engine';
export * from './lib/sources';
export * from './lib/views';
export * from './lib/describe';
export * from './lib/target';
export * from './lib/diff';
```

### `libs/server/src/lib/` — feature folders matching the HTTP surface

```
libs/server/src/lib/
├── bootstrap/
│   ├── index.ts
│   ├── create-server.ts
│   ├── server.module.ts
│   ├── watcher-chain.ts (+spec)
│   ├── engine-map.ts (+spec)
│   ├── registry-mode.spec.ts
│   └── tokens.ts
├── sparql/
│   ├── index.ts
│   ├── sparql.controller.ts (+spec)
│   └── registry-sparql.controller.ts
├── config/
│   ├── index.ts
│   └── config.controller.ts
├── diff/
│   ├── index.ts
│   ├── diff.controller.ts (+spec)
│   └── diff.service.ts (+spec)
├── describe/
│   ├── index.ts
│   ├── describe.controller.ts (+spec)
│   └── describe.service.ts (+spec)
└── snippet/
    ├── index.ts
    ├── snippet.controller.ts (+spec)
    └── snippet-allow-list.ts (+spec)
```

### `apps/cli/src/app/runner/` — light sub-clustering

```
apps/cli/src/app/runner/
├── runner.ts (+spec)
├── project-config-schema.ts
├── config/
│   ├── discover-config.ts (+spec)
│   ├── file-loader.ts (+spec)
│   └── normalize-config-paths.ts (+spec)
└── fields/
    ├── field.ts (+spec)
    ├── fields-shared.ts (+spec)
    ├── merge.ts (+spec)
    ├── meta-flags.spec.ts
    └── spec.ts (+spec)
```

`runner.ts` and `project-config-schema.ts` stay at the runner root — they are the entry and the top-level schema, not members of either sub-cluster. No barrels: the runner is a private folder inside the CLI app and is consumed only by its own `main.ts`; the existing relative-import discipline is sufficient.

### Boundary rules (libs)

- **A `<feature>/` folder is a module** — it has its own `index.ts` barrel, owns its internals, and can export many functions. "Feature" means a named domain concept (typically one that appears in CONTEXT.md), not a single function.
- **`shared/`** is the libs analog of the webapp's `core/`: atomic primitives that are **orthogonal** to any one feature. One concept per file, no domain coupling. `shared/` never grows inner sub-modules — if a cohesive cluster accumulates there, it graduates to its own `<feature>/` folder.
- **Promotion is keyed on orthogonality, not on consumer count.** A helper used by another feature does *not* automatically get promoted to `shared/`. If the helper is conceptually part of `diff` (or `views`, etc.), it stays in `diff/` and other features import it via the `diff` barrel — that's normal cross-feature use, not a smell. Promotion happens only when the helper is genuinely independent of the feature's concern.
- **A `<feature>/` folder may grow internal sub-folders** (e.g. `diff/graph/`, `diff/tabular/`) the first time it has multiple files of the same sub-kind. Subdivision is on demand — no empty stubs, no inner barrels for organizational sub-folders.
- **Each CLI command is one file *or* one folder.** A command folder (`apps/cli/src/app/commands/<command>/`) follows the same internals rules as a `libs/core` feature: cohesive siblings, no inner barrel for organizational sub-folders, cross-file imports relative. The runner imports the entry file directly. This recognises the per-command-folder shape validated by #256 (splitting `diff.ts` into `commands/diff/`); the original "Out of scope — `apps/cli/src/app/commands/` stays flat" rule was right when every command fit in one file and is superseded for commands that have outgrown that.

### Barrel discipline (libs)

- One `index.ts` per feature folder. The package barrel `src/index.ts` re-exports the feature barrels wholesale (no curation pass at restructure time — the existing public surface is preserved).
- **Subpath exports are public.** `libs/core`'s `package.json` declares an `exports` map with a `./` root entry and a `./*` wildcard, and `tsconfig.base.json` carries matching path aliases (`@sparqly/core` and `@sparqly/core/*`). External consumers may import `@sparqly/core/diff` directly if they want the slice rather than the package. This is a deliberate widening of the public API — see Considered alternatives for why it diverges from ADR-0013's webapp rule.
- **Inside a lib**, cross-feature imports go through the feature barrel (`../diff`, not `../diff/tabular-diff`); intra-feature imports are relative (`./tabular-diff`). Same principle as ADR-0013: barrels are for outsiders.
- **No inner barrels for organizational sub-folders** (e.g. a future `diff/graph/`): they are not module boundaries.

### Naming (libs)

- **No new suffix conventions** for `libs/core`, `libs/common`, `apps/cli`: bare kebab-case filenames stay. The feature folder is the structural signal; a file-level suffix would be redundant.
- **`libs/server` keeps NestJS suffixes** (`.controller.ts`, `.service.ts`, `.module.ts`) — those are framework-imposed and already universal in that lib.
- **`.spec.ts` co-location** stays the rule everywhere.
- **The feature folder's `index.ts` is its entry.** There is no "main file matching the folder name" convention; the barrel decides what is public.

### Out of scope

- **`libs/common/src/lib/`** (5 files) and **`libs/domain/src/lib/`** (1 file) stay flat. Below the legibility threshold; subdividing now would be empty ceremony.
- **`apps/cli/src/app/commands/`** stays flat. Each command is one file (plus its spec); the folder already names the cluster.
- **`apps/web/`** is governed by ADR-0013 and unchanged here.
- **CONTEXT.md** is unchanged: this ADR codifies code structure, not domain language. The features named here (engine, sources, views, diff, describe, target, canonical) are already in CONTEXT.md as domain concepts; this ADR just makes the folder layout reflect them.

### Migration

Phased PRs in dependency order, leaves first, each green on typecheck + tests, each citing this ADR. `libs/core` phases:

- **A** — `libs/core/package.json` `exports` map + `tsconfig.base.json` path aliases (`@sparqly/core`, `@sparqly/core/*`). No file moves.
- **B** — `shared/` (parse-sparql-prefixes, env-substitute).
- **C** — `canonical/` (canonicalize, strip-annotations, immutability).
- **D** — `engine/` (query-engine, rdf-loader, rdf-file-parser, endpoint-http, endpoint-load).
- **E** — `sources/` (source-spec, transform-spec, transform-pipeline, annotate-transform, graph-name-transform, source-record-builder, source-path-display, load-sources, resolve-source, resolve-source-references, with-auto-source-annotation).
- **F** — `views/` (view-query-validate, view-resolver, view-cache, view-pass-through, anonymous-view-builder, resolve-anonymous-select-bindings).
- **G** — `describe/` (describe-store, describe-endpoint, relabel-bnodes).
- **H** — `target/` (select-target, resolve-serve-scope).
- **I** — `diff/` (diff, group-rdf-diff-by-entity, grouped-diff-formatter, html-diff-composer, format-human-source-comment, compress-source-records, source-snippet-reader, tabular-diff, tabular-diff-formatter, tabular-row-key, select-shape-detector).
- **J** — collapse `libs/core/src/index.ts` to eight `export * from './lib/<feature>'` lines; delete the per-module re-exports.

Then:

- **K** — `libs/server` feature folders (`bootstrap/`, `sparql/`, `config/`, `diff/`, `describe/`, `snippet/`) with per-folder barrels and a collapsed package barrel.
- **L** — `apps/cli/src/app/runner/` light sub-clustering (`config/`, `fields/`); `runner.ts` and `project-config-schema.ts` stay at runner root; no barrels.

## Considered alternatives

- **Literal ADR-0013 layout — `core/` + `modules/` + `pages/` inside `libs/core/`**. Rejected: `pages/` does not translate (no router targets); forcing the three-bucket split would produce dead vocabulary. Feature folders + `shared/` is the same idea adapted to a library — cohesive named units with private internals, plus an atomic-primitive bucket.
- **Promotion on "second consumer" (the ADR-0013 mechanical rule)**. Rejected: in a library, features legitimately export many functions and legitimately call into one another. A helper used by both `diff` and `hash`-via-`canonical` is not a smell — it's the library doing its job. The webapp's rule fit because pages are router-leaf clusters with genuine privacy; library features are peers. Orthogonality is the sharper criterion: "is this concept independent of the feature it lives in?" If yes, promote; if no, leave it.
- **Single public entrypoint, no subpath exports** (the ADR-0013 webapp rule). The webapp rejected `@app/modules/header/components/header-drift` because internal organizational folders should not be public. That reasoning does not transfer: `libs/core`'s feature folders are not internal organization — they are the library's *features*, and exposing each as `@sparqly/core/diff` lets consumers depend on a slice rather than the whole package. The trade-off is API surface (wider) vs caller clarity and dead-code elimination (better). Accepted that widening here; rejected it for the webapp where the boundaries were organizational, not feature-shaped.
- **Subdivide `diff/` into `diff/graph/` + `diff/tabular/` from day one**. Two clean sub-clusters visible in the file names. Rejected: pre-emptive subdivision is not free — it forces every new diff file to answer "graph or tabular?" before the file has earned that question. The on-demand sub-folder rule applies; `diff/` stays flat-within-the-folder until the cost of *not* splitting bites. The rule is the value, not the snapshot.
- **Wildcard alias vs explicit per-feature aliases** (`@sparqly/core/*` vs listing `@sparqly/core/diff`, `@sparqly/core/views`, … explicitly). Explicit list is more deliberate — a new feature folder requires a tsconfig edit before it is reachable, which is a small forcing function. Wildcard is less maintenance and makes new feature folders work immediately. Picked wildcard: the forcing function is a footgun, not a feature, and the feature-folder list is already enumerated by the package barrel.
- **Order migration by domain importance (engine → sources → views → diff …) rather than leaves-first**. Rejected: each PR's surface area is dominated by the barrel and import rewrites. Leaves-first (shared, canonical) keeps the early PRs small and lets the barrel collapse to happen once at the end, after every feature has its own folder. Domain-order is meaningful for *understanding* the codebase, not for *moving files in it*.
- **Restructure `libs/common` and `libs/domain` for symmetry**. Rejected: 5 files and 1 file. Folder structure is a legibility tool with a cost; below ~10 files the cost exceeds the gain. The rule "subdivide when flat stops being legible" matters more than the rule "every lib looks the same."
- **A single big-bang restructure PR per package**. Rejected for the same reason ADR-0013 rejected it: reviewer-hostile, rebase-hostile, and obscures which moves caused which test failures. Phased per-feature PRs stay bisectable.

## Consequences

- **Every file in `libs/core/src/lib/` moves**: ~50 source files relocate into eight feature folders or `shared/`. Imports rewrite from `@sparqly/core` deep paths (where used internally) to feature barrels, and the package barrel shrinks from 39 lines to 8.
- **`libs/core/package.json` gains an `exports` map** with a `./*` wildcard; **`tsconfig.base.json` gains `@sparqly/core/*` path aliases**. Nx project graph and build pick up the new paths.
- **Public API widens deliberately**: `@sparqly/core/<feature>` subpath imports become supported. External callers (today: `apps/cli`, `libs/server`) keep working via the package root; new callers can pick a slice.
- **`libs/server/src/lib/` reshapes into six feature folders** mirroring the HTTP surface; the package barrel collapses to one re-export per folder. NestJS suffix conventions stay unchanged.
- **`apps/cli/src/app/runner/` gets `config/` and `fields/` sub-clusters**; the runner entry and project-config schema stay at the runner root. No new barrels — the runner remains a CLI-app-private folder.
- **Promotion rule diverges from ADR-0013**: orthogonality-keyed, not consumer-count-keyed. This is the libs-specific rule going forward; ADR-0013's webapp rule remains the webapp's.
- **CONTEXT.md unchanged**: domain vocabulary already names the feature folders; the ADR aligns folders with vocabulary rather than the other way around.
- **No public HTTP, CLI, or runtime change**: this is an internal restructure plus a deliberate widening of `libs/core`'s import surface. The CLI commands, `serve` routes, and rendered SPA are unaffected.
- **Threat surface unchanged**: no new endpoints, no new dependencies, no script-execution paths.
