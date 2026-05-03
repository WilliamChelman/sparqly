---
status: accepted
---

# Commands target a single source; cross-source composition uses SPARQL `SERVICE`

The `query`, `serve`, `hash`, and `diff` commands run against exactly one **target source** chosen from the **source registry**. The CLI accepts a single `--source`/positional value (an `@id` ref or an inline glob/URL); configs declare a multi-entry registry and may mark one entry `default: true`. Multi-source merging at the command boundary is removed: the previous "load every registry entry into one merged Store" path is replaced by target-only resolution, and `loadQuerySources(inputs[])` is split into `selectTarget(registry, target) → ParsedSource` and `resolveSource(parsed) → QuerySources`. Cross-source composition is delegated to `SERVICE` clauses authored in a view query, optionally hosted on an **empty source** when the upstream cannot federate.

This is the same simplification ADR-0004 applied to `view.from`, lifted one level up to the command boundary.

## Considered Options

- **Whole-registry resolution (load every entry, run/serve only the target).** Rejected — does I/O the user did not ask for, re-creates the materialize-merge cost on every command run, and obscures which sources a command actually touches. Parse-time validation across the whole registry is cheap and is kept; runtime resolution is target-only.
- **"Leaf" auto-detection (pick the source no other source references).** Rejected — leafhood is a graph property the user has to recompute mentally, breaks down with multiple leaves (two endpoints + two views from each), and a magic rule is harder to explain than an explicit `default: true` marker.
- **Top-level `target: '@id'` key in the config alongside `sources: [...]`.** Rejected — adds a second way to express the same intent already covered by per-entry `default: true`, and forces the user to look in two places to understand which source is selected.
- **Lenient unwrap of `--source @a @b` / array form.** Rejected for the same reason ADR-0004 rejected lenient `from: ['@a']` unwrap: silent unwrap of a multi-element value would be data loss; a hard error pointing at `SERVICE` and `empty` is clearer.
- **Keep multi-glob positional only (allow `query a/*.ttl b/*.ttl` but reject mixed kinds).** Rejected — codifies a special case that exists purely because `SERVICE` cannot reach a glob. Users who need to merge file sets can collapse to a broader glob pattern; "compose multiple file sets into one queryable view" is what a triple store is for, not a CLI command.
- **Treat `kind: 'reference'` as a valid target (auto-deref to the underlying source).** Rejected — references are aliases, not data; allowing them as targets complicates error messages and the `default: true` rule. Targets must name the underlying source directly.

## Consequences

- **CLI shape**: `--source` (singular) replaces `--sources`; the positional accepts exactly one value (an `@id` ref or an inline glob/URL). Two positionals or an array form is rejected with an error that names the escape routes (single broader glob, or `SERVICE` from a view on an `empty` source) and links this ADR.
- **Config shape**: `sources: [...]` (registry, plural) is unchanged. Each entry may add `default: true`; at most one entry per registry may carry the marker. `default: true` on a `kind: 'reference'` entry is a parse-time error.
- **Selection precedence** (highest to lowest): explicit positional/flag → `default: true` entry → sole registry entry → error listing available `@ids`.
- **Public lib API**: `loadQuerySources(inputs: ReadonlyArray<SourceSpecInput>, …)` is removed. New entry points: `selectTarget(registry, target?: string) → ParsedSource` and `resolveSource(parsed, options) → QuerySources`. The `QuerySources` discriminated union (`pass-through` | `materialized`) is retained.
- **`createServer` API**: takes `{ sources, target, … }` instead of `{ sources, … }`. `sources` keeps mirroring the config key (the registry); `target` is the new optional selector with the same precedence rules as the CLI.
- **Resolution scope**: only the target's transitive `from:` chain is loaded/opened. Whole-registry parse validation is preserved (cheap, catches typos in unrelated entries on next target switch).
- **Watcher scope** (`serve --watch`): only globs reachable from the target chain are watched; only the target view's `cache.ttl` timer and `cache.freshness` probe run. Untargeted views in the registry are not polled.
- **`loadSources` audit**: the merged-store form has no remaining caller after `loadQuerySources` is removed. `loadSources` is narrowed in the same change to "load one ParsedSource into a Store" (the body for the non-multi case today).
- **`hash` and `diff`**: positional collapses to a single value, same rules as `query`. Already use anonymous views (single-upstream) internally; the CLI surface now matches.
- **Result cache**: keys are unchanged. Pre-existing cache entries for non-target views remain on disk and are simply not read; no migration needed.
- **Breaking change**: configs that relied on multi-source merging at the command boundary (multi-glob positional, array `--sources`, `createServer({ sources: [a, b] })` with intent to merge) stop working. No deprecation window — sparqly is in alpha.
- **Glossary**: `CONTEXT.md` adds **Source registry**, **Target source**, **Default source**; rewrites `query` and `serve` relationships for the single-target model.
