---
status: accepted
---

# Webapp folder layout and module conventions

## Context

`apps/web/src/app/` is currently flat: every component, page, service, and utility sits at the same level (`app.ts`, `query-page.ts`, `diff-page.ts`, `result-pane.ts`, `result-table-select.ts`, `term-cell.ts`, `config.service.ts`, …). At ~50 files there is no folder-level signal for which files are page-private, which are reused across pages, which are services, or which are pure utilities. New contributors (and future-self) reconstruct that map by reading every file's import list.

The dependency graph already has clear boundaries that the folder structure hides:

- **Page-private clusters**: `query-page` privately consumes 11 files (`editor-frame`, `result-pane`, `result-{ask,illustrations,raw,table-select,table-triples}`, `state-card`, `term-cell`, `term-renderer`, `csv-exporter`); `diff-page` privately consumes 3 (`diff-result-renderer`, `source-snippet`, `diff.service`). Nothing outside each page imports these files, but the folder-level co-location does not exist.
- **Cross-page reuse**: `sources-picker` (query + diff), `yasqe-editor` (diff directly + query via `editor-frame`). They are reused but live as siblings to single-use components.
- **App-shell chrome**: `header-drift`, `logomark`, `theme-toggle` are imported only by `app.ts` and conceptually compose a header that has not been extracted as a component.
- **Cross-cutting**: `config.service`, `theme.service`, `sparql-result-decoder` (used in 8 places), `query-detection` (used in 2). Today indistinguishable from page-specific code.

The flat layout also lets non-rules accumulate silently: there is no naming convention separating router-mounted components (`*-page.ts` is current convention but ad-hoc) from in-template components, no convention for where new services land, no answer to "where does this new file go" beyond "wherever the existing similar files are." Every PR adding a component renegotiates the layout implicitly.

## Decision

Restructure `apps/web/src/app/` along three top-level boundaries — `core/`, `modules/`, `pages/` — and codify suffix, barrel, and promotion rules so future placements are deterministic.

### Top-level layout

```
apps/web/src/app/
├── app.component.ts (+spec)
├── app.routes.ts
├── app.config.ts
├── core/
│   ├── index.ts                          # single barrel: @app/core
│   ├── services/                         # internal organization, no inner barrel
│   │   ├── config.service.ts (+spec)
│   │   └── theme.service.ts (+spec)
│   └── utils/                            # internal organization, no inner barrel
│       ├── sparql-result-decoder.ts (+spec)
│       └── query-detection.ts (+spec)
├── modules/
│   ├── header/
│   │   ├── index.ts                      # @app/modules/header
│   │   ├── header.component.ts (+spec)   # entry, at folder root
│   │   └── components/
│   │       ├── header-drift.component.ts (+spec)
│   │       ├── logomark.component.ts (+spec)
│   │       └── theme-toggle.component.ts (+spec)
│   ├── sources-picker/
│   │   ├── index.ts
│   │   └── sources-picker.component.ts (+spec)
│   └── yasqe-editor/
│       ├── index.ts
│       └── yasqe-editor.component.ts (+spec)
└── pages/
    ├── query/
    │   ├── index.ts                      # @app/pages/query
    │   ├── query.page.ts (+spec)
    │   ├── components/
    │   │   ├── editor-frame.component.ts (+spec)
    │   │   └── result/                   # organizational subcluster, no barrel
    │   │       ├── result-pane.component.ts (+spec)
    │   │       ├── result-ask.component.ts (+spec)
    │   │       ├── result-illustrations.component.ts (+spec)
    │   │       ├── result-raw.component.ts (+spec)
    │   │       ├── result-table-select.component.ts (+spec)
    │   │       ├── result-table-triples.component.ts (+spec)
    │   │       ├── state-card.component.ts (+spec)
    │   │       ├── term-cell.component.ts (+spec)
    │   │       └── term-renderer.component.ts (+spec)
    │   └── utils/
    │       └── csv-exporter.ts (+spec)
    └── diff/
        ├── index.ts                      # @app/pages/diff
        ├── diff.page.ts (+spec)
        ├── components/
        │   ├── diff-result-renderer.component.ts (+spec)
        │   └── source-snippet.component.ts (+spec)
        └── services/
            └── diff.service.ts (+spec)
```

### Boundary rules

- **`core/`** holds atomic, cross-cutting single units — one service or one utility per file. It is itself a module (single barrel `core/index.ts`); `core/services/` and `core/utils/` are internal organization with no inner barrels.
- **`modules/<name>/`** holds cohesive named units that are either reused by 2+ pages or grow past one file. Each is a module folder with its own `index.ts`. Single-component modules (e.g. `sources-picker`, `yasqe-editor`) are valid — the entry component sits at folder root; no `components/` subfolder is needed until a second component appears.
- **`pages/<name>/`** holds router targets. Page-private code lives inside; nothing outside the page may import its internals. The page's only public export is the page class via `pages/<name>/index.ts`.

### Naming

- **Files**: `*.page.ts` for components mounted via the router; `*.component.ts` for every other Angular component; `*.service.ts` for services; bare names for non-Angular utilities (`csv-exporter.ts`, `sparql-result-decoder.ts`). Specs co-located with `.spec.ts`.
- **Classes mirror the file suffix**: `DiffPage`, `HeaderComponent`, `EditorFrameComponent`, `ConfigService`, `ThemeService`. The bare `App` class becomes `AppComponent` (the root shell follows the rule, not the Angular CLI default).
- **kebab-case** filenames throughout.
- **CSS selectors** keep their `app-*` prefix unchanged.

### Promotion criteria

A file lives in `pages/<page>/` until it has a second consumer; then it is promoted to `modules/<name>/`. A `core/` file is reserved for things genuinely usable from anywhere — services and pure utilities with no domain coupling. The promotion path is mechanical (move + rename imports + add to barrel); decisions are made at the moment of the second consumer, not speculatively.

A `modules/<name>/` folder may grow internal subfolders (`components/`, `services/`, `utils/`, `model/`) the first time it has multiple files of the same kind. Subfolders are created on demand — empty kind-folders are not pre-created.

If `core/` accumulates a strongly cohesive cluster (e.g. several SPARQL-related utilities sharing types), the cluster is promoted to `modules/<name>/` (e.g. `modules/sparql/`), not split into `core/sparql/`. `core/` does not host inner sub-modules.

### Barrel discipline

- One `index.ts` per module (`core/`, every `modules/<name>/`, every `pages/<name>/`). External consumers always import via the barrel: `from '@app/core'`, `from '@app/modules/header'`, `from '@app/pages/query'`.
- The barrel exports only the module's entry by default — `HeaderComponent` for `modules/header`, `QueryPage` for `pages/query`, the full set of cross-cutting services and utilities for `core`. Internals (header-drift, logomark, theme-toggle, page-private components) are not exported. The surface widens case-by-case if a real consumer emerges; otherwise the right move is to promote the would-be-exported file to its own module.
- **No inner barrels**: `core/services/index.ts` and `core/utils/index.ts` do not exist; `pages/query/components/index.ts` does not exist; `pages/query/components/result/index.ts` does not exist. These folders are organizational, not module boundaries.
- **Internal cross-references use relative paths**, never the module's own barrel. A file inside `modules/header/` reaching a sibling under `modules/header/` imports via `../components/header-drift.component`, not via `@app/modules/header`. This prevents barrel-induced circular imports and makes the rule mechanical: barrels are for outsiders.

### Router-mounted vs in-template

`*.page.ts` is reserved for components reachable through `RouterOutlet` (today: `query.page.ts`, `diff.page.ts`). `*.component.ts` covers everything else. The split is folder-anchored too: pages live only under `pages/<name>/`, components live anywhere else.

### App shell

`app.ts` becomes `app.component.ts` with class `AppComponent`. Its template — currently the inlined header bar plus `<router-outlet />` — collapses to roughly `<app-header />` plus `<router-outlet />` after `HeaderComponent` is extracted. `app.routes.ts`, `app.config.ts`, and `app.spec.ts` stay flat at the `app/` root; they are bootstrap glue, not a module.

### Migration

Phased PRs in dependency order, each green on typecheck + tests:

- **A**: tsconfig path aliases (`@app/*`) + `core/` (config + theme + sparql-result-decoder + query-detection move; `core/index.ts` barrel).
- **B**: `modules/header/` — extract `HeaderComponent` from `app.component.ts`'s template; move `header-drift`, `logomark`, `theme-toggle` under `modules/header/components/`.
- **C**: `modules/sources-picker/`, `modules/yasqe-editor/`.
- **D**: `pages/query/` — page entry + `editor-frame` + the `components/result/` subcluster + `utils/csv-exporter`.
- **E**: `pages/diff/` — page entry + `diff-result-renderer` + `source-snippet` + `services/diff.service`.
- **F**: `app.ts` → `app.component.ts` rename (`App` → `AppComponent`); update `app.routes.ts` page imports to use `@app/pages/*`.

Each phase PR cites this ADR.

## Considered alternatives

- **Status quo flat layout**. Cheapest. Rejected: the implicit cost compounds — every contributor reconstructs the page-private vs reused vs cross-cutting map by hand, and new files land "wherever the similar ones are," eroding any latent structure. The webapp is past the size where a flat layout is legible.
- **Single `features/` folder instead of separate `pages/` and `modules/`**. Common in larger Angular apps. Rejected: pages and modules answer different questions — a page is a router target with private internals, a module is a reusable surface with a public entry. Folding both into `features/` removes the at-a-glance signal that this refactor exists to add. The cost of the second top-level folder is one folder.
- **`shared/` instead of `modules/`**. Rejected: `shared/` is conventionally a dumping ground (shared/components/, shared/services/, shared/utils/), reproducing the flat-layout problem one level down. `modules/<name>/` forces the question "what unit does this belong to" at every placement.
- **No `core/`; cross-cutting services live in `modules/core/` or directly under `app/`**. Rejected: `core/` carries a specific connotation in Angular guidance (singletons, app-wide services) that aligns with the contents we want there. Folding it under `modules/` would muddle the criteria — `core/` files are not "modules" in the same sense; they are atomic single-unit cross-cutting code. Treating `core/` as one peer module to `modules/<name>/` (single barrel, internal subfolders) is the cleanest reconciliation.
- **Class names match Angular CLI v20+ defaults (bare names: `Header`, `EditorFrame`, `ResultPane`)**. Rejected: with three concurrent suffix conventions in play (`*.page.ts`, `*.component.ts`, `*.service.ts`), bare class names lose the at-import-site signal of what kind of thing is being imported. `HeaderComponent` vs `HeaderPage` vs `HeaderService` answers in one token a question the bare form punts to context. The cost is uniform suffix noise; the win is uniform readability. Pages keep their `Page` suffix anyway; matching it for components and services is symmetry, not novelty.
- **Module-level barrels everywhere, including `core/services/index.ts` and `pages/query/components/index.ts`**. Maximally clean import sites (`from '@app/core/services'`). Rejected: every barrel is a circular-import hazard and a tree-shaking pessimization, and the gain is cosmetic — `from '@app/core'` already covers the external surface, and inner-folder consumers are inside the same module and use relative imports. Barrels are paid for by the modules they bound; multiplying them costs without buying.
- **Always-subdivide with empty stub folders** (`pages/diff/components/`, `pages/diff/services/`, `pages/diff/utils/`, `pages/diff/model/` all created up front, even when empty). Rejected: empty folders communicate nothing and accumulate gitkeeps. Subdivide on demand; the folder shape is predictable enough from the rules without pre-staging.
- **Promote `editor-frame` to `modules/`** because it's editor-related and could plausibly be reused. Rejected: speculative reuse. `editor-frame` has exactly one consumer today (query-page); promotion is a 5-minute follow-up if a second one appears. The rule is "promote on real reuse," not "promote on plausible reuse."
- **Promote a `modules/result/` for the result-rendering subcluster**. The 9 result components are cohesive and might be reused on a future page. Rejected: same reasoning — cohesive ≠ reused. Today they have one consumer (query.page via result-pane). They are co-located under `pages/query/components/result/` so the cluster is legible without making it a public surface.
- **Selectors gain a per-module prefix** (`hdr-`, `qry-`, `dff-` instead of `app-`). Rejected: zero functional benefit, breaks every template, and Angular's convention is one prefix per app — multiplying prefixes optimizes for nothing.
- **Big-bang single PR**. Reviewer-hostile, rebase-hostile for any branch in flight, and obscures which moves caused which test failures if any do. Phased migration in dependency order keeps each PR self-contained and bisectable.

## Consequences

- **Every webapp file moves**: ~50 source files relocate into `core/`, `modules/`, or `pages/`. Imports rewrite to `@app/*` aliases. Specs follow their targets.
- **TypeScript path aliases land in `tsconfig.base.json`**: `@app/core`, `@app/modules/<name>`, `@app/pages/<name>`. The Nx workspace build picks up the new paths.
- **New component**: `HeaderComponent` is extracted from `app.component.ts`'s template. `app.component.ts`'s template collapses to `<app-header />` plus `<router-outlet />`. The header's nav, theme-toggle slot, and `app-header-drift` / `app-logomark` mounts move into `header.component.ts`.
- **App shell rename**: `app.ts` → `app.component.ts`, class `App` → `AppComponent`. `app.routes.ts` imports `QueryPage` and `DiffPage` from `@app/pages/query` and `@app/pages/diff` respectively.
- **Web service rename ripples**: nothing today is named ambiguously, but future contributors get a clear rule — class suffix matches file suffix, no exceptions for the root shell.
- **No public API change**: this is purely an internal restructure. The `serve` HTTP surface, the rendered SPA, and any external consumer of the webapp are unaffected.
- **CONTEXT.md is unchanged**: this ADR codifies code structure, not domain language. The webapp's domain vocabulary is unaffected.
- **Future placement decisions become deterministic**: every new file is either page-private (lives under its `pages/<name>/`), reused across pages (lives under `modules/<name>/`), or cross-cutting (lives under `core/`). The promotion rule covers movements between those buckets.
- **Threat surface unchanged**: no new endpoints, no new dependencies, no script-execution paths.
