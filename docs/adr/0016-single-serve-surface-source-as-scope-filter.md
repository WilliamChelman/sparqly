---
status: accepted
amends: 0011
---

# Single `serve` surface; `--source` is a scope filter, not a mode switch

## Context

ADR-0011 split `serve` into **Registry mode** (no `--source`: expose every source, parameterized `/api/sparql/<id>`, plus `/api/diff`, `/api/describe`, `/api/source-snippet`) and **Single-source mode** (`--source`/positional given, *or* a lone id-less source: one unparameterized `/api/sparql`, no `/api/diff`, no `/api/describe`, no source picker). In practice the two modes differ only in (a) route shape, (b) which controllers are mounted, and (c) whether the lone source needs a declared `@id`. The mode trigger is also subtle: `sources: [{ glob }]` lands in single-source mode but `sources: [{ id: 'd', glob }]` lands in registry mode — "a registry with one source" is already ambiguous between the two modes. And the fork had already drifted: CONTEXT.md claimed the Describe page worked "in both Registry mode and Single-source mode", but `DescribeController` (and `DiffController`) were only registered for `mode: 'registry'`, so the SPA's `/describe` and `/diff` routes POST to 404s under single-source mode.

The driving question: does `serve` need *two server shapes*, or one shape plus a way to scope what it exposes?

## Decision

`serve` has **one surface**. `createServer` always builds the `EngineMap`, always mounts `RegistrySparqlController`, `DiffController`, `DescribeController`, `SnippetController`, and `ConfigController`. The `mode: 'single' | 'registry'` discriminator, `SparqlController`, `buildSingleListing`, the inline-single-source branch in `createServer`, and the `selectTarget`-for-`serve` path are removed.

`--source`/the positional becomes a **scope filter**, not a mode switch:

- **`@id` ref** → the *served and listed* registry is narrowed to that one entry. Sources reachable only through `from:` chains stay in the *resolution* registry (the view still needs them) but get no `/api/sparql/<id>` route and do not appear in `/api/config`. A leading `@` that does not resolve is an error listing the available `@ids`.
- **Inline glob/URL** → the served set is a single synthesized entry (see below). Any configured `sources:` remain available for `from:` resolution only — unchanged from today.
- Absent → the whole non-`reference` registry is served (today's Registry mode).

### Synthetic `@id` for id-less sources

A lone id-less source — whether inline (`sparqly serve foo.ttl`) or `sources: [{ glob: '*.ttl' }]` — is given `@id` `default` and marked `default: true`. (Multiple id-less sources in a `sources:` array remains as-is — already unreferenceable by views and unselectable by `--source`.)

### `/api/sparql` (unparameterized) survives as an alias

Always mounted; forwards to the source carrying `default: true` — and a sole served entry counts as the default even without the explicit marker. With two or more served sources and no `default:` marker, `/api/sparql` returns 404 with a body listing the `/api/sparql/<id>` routes. This preserves the `sparqly serve foo.ttl` quick-start URL and Yasgui's default playground page with no fork in the server. After `--source` filtering, the default is recomputed: a surviving explicit `default:` marker wins, otherwise the sole served entry is the default.

### Degenerate cases need no special handling

`/api/diff` with one served source can only diff that source against itself (empty result) — harmless, and the SPA `/diff` page already shows an empty state for single-`@id` registries (ADR-0011). `/api/describe` with one served source is fully meaningful and the SPA picker already collapses to it (ADR-0015). So both endpoints mount unconditionally.

## Considered alternatives

- **Keep the two modes, fix only the docs.** Rejected: the fork buys nothing behavioural that "one surface + a scope filter" doesn't, and the subtle mode-trigger (id-less vs. id'd lone source) is a permanent papercut.
- **Keep the two modes, give single-source mode feature parity** (mount `/api/diff` + `/api/describe` there too). Rejected: at that point the only difference is route shape, which doesn't justify a `mode` discriminator threaded through `createServer` and `ServerModule`.
- **`--source` as an initial-selection hint only** (registry always fully served). Rejected for the same reason ADR-0011 rejected it: it removes the only way to expose a single source for scope/security reasons.
- **`--source` inline-only** (can no longer pick one `@id` out of a multi-source config). Rejected: scoping a configured registry down for one `serve` invocation is a real use case that today's single-source mode supports.
- **Drop `--source`/the positional entirely.** Rejected: kills `sparqly serve foo.ttl`, the most common quick-start gesture.
- **Drop the unparameterized `/api/sparql` entirely.** Rejected: needlessly breaks every existing script/Yasgui config pointed at `/api/sparql` when a cheap alias preserves them. (sparqly is alpha, so this would be *survivable* — just not worth it.)
- **Synthetic `@id` derived from the input** (`serve foo.ttl` → `@foo`). Rejected: unpredictable, collision-prone, awkward for `data/**/*.ttl`. A fixed `@default` is predictable and self-documents the default-selection role.
- **`--source @x` serving the whole transitive `from:` closure.** Rejected: leaks the sources the user explicitly narrowed away; filtering the *served* set while keeping the *resolution* set whole matches today's single-source-mode behaviour.

## Consequences

- **`serve` CLI shape**: positional/flag stays optional; when given it filters rather than switching modes. Help text drops the "Registry mode vs Single-source mode" framing in favour of "exposes every source; pass a source to scope to one".
- **`createServer` API** (`libs/server`): `target` (the single-source selector) is removed in favour of an optional scope filter; `ServerModule.forRoot` loses its `mode` discriminator and `SingleSourceModuleOptions` — it always takes an `engineMap`.
- **Controllers**: `SparqlController` is deleted; `RegistrySparqlController` gains the `/api/sparql` → default-source alias. `DiffController`, `DescribeController`, `SnippetController`, `ConfigController` are unconditional.
- **`/api/config` listing**: id-less lone source listed as `@default`; under `--source @id`, only the filtered entry (and its transitive `from:` deps are *not* listed).
- **Watcher chain**: already per-source in Registry mode; now the only path. The narrowed-chain logic that single-source mode used is folded into the filtered-registry path.
- **ADR-0011**: its two-mode decision is superseded by this one — the registry-aware surface (parameterized routes, `/api/diff`, `/api/describe`, `/api/source-snippet`, the SPA's pages) stays; the Single-source *mode* does not. ADR-0005 remains amended (the `serve` carve-out from "single target source at command boundary" still holds — `serve` operates on the registry, optionally scoped).
- **CONTEXT.md**: **Registry mode** and **Single-source mode** are removed; **Target source**, **Default source**, **Describe**, and **Describe page** are rewritten to the single model. The pre-existing false claim that the Describe page worked in single-source mode is resolved by construction.
- **Breaking change**: `createServer` callers passing `target` must migrate; the unparameterized `/api/sparql` now 404s when 2+ sources are served with no `default:` marker (previously single-source mode guaranteed it existed). No deprecation window — sparqly is alpha.
