---
status: accepted
amends: 0010, 0011
---

# Shared `context:` block for IRI display, consumed by CLI commands and webapp

## Context

ADR-0010 placed `prefixes`, `base`, and `objectAnchoredPredicates` under the `format:` block, with the project-wide schema rejecting them at root and redirecting to `format.*`. The block name encoded the convention "block name = command name": the `format` command read `format:`. Only `format` consumed those keys; `diff`, `query`, `hash`, and `serve` had no path from config to their own IRI rendering.

ADR-0011 stood up `/api/diff` and the webapp diff page, with the response shape JSON-typed and explicitly deferring prefix shaping to "the SPA renderer." But the SPA renderer (`apps/web/src/app/diff-result-renderer.ts`) hardcodes `DEFAULT_PREFIXES` (rdf, rdfs, owl, xsd) at all three of its IRI sites — `termText` for tabular cells, `curieOrIri` for graph hunk anchors, `shortenNQuadLine` for graph hunk lines. There was no channel for user-defined prefixes to reach it. `ideas.md:32-33` flagged "diff > prefixes" as a known gap.

Once `diff`'s text outputs (`human` / `rdf-patch` / `turtle` / `html`) and the webapp diff renderer all want the same prefix map, the `format:` block becomes a misnomer: the keys are not format-command-scoped, they are project-wide IRI-display config. Renaming the consumers to read `format:` would entrench the misnomer; introducing a duplicate `diff:` block with the same keys would fork the project's prefix map. Neither preserves a single source of truth.

Separately, the webapp had two independent boot calls coming: `GET /api/sources` (today, registry listing) and a notional second call for display config. They are both registry-wide static state for the lifetime of a `serve` process; splitting them across endpoints would coupling-by-accident the webapp's two boot calls without buying separation that matters anywhere else.

## Decision

A new top-level `context:` block carries IRI display config — registry-wide, consumed by every command that renders IRIs and by the webapp diff renderer. It is structurally a block (preserving ADR-0010's "no flat root" rule) but architecturally a top-tier layer like `sources:` (read by every command, not opted into per-command).

### Block shape

```yaml
context:
  prefixes:
    ex: http://example.org/
    rdfs: http://www.w3.org/2000/01/rdf-schema#
  base: http://example.org/
```

`context.prefixes` is `Record<string, string>`. `context.base` is an optional IRI string. Both fields are optional; an empty `context:` block is legal and equivalent to omitting it.

The block is named after JSON-LD's `@context` for the prefix-map + base semantic. The shape uses sparqly-internal subkeys (`prefixes:` / `base:`) rather than the literal JSON-LD spelling (`'@base':` would force YAML quoting, and `@`-keyed extension space is forever-constrained by the JSON-LD reserved-keyword set). The block-name analogy is enough; the contents are sparqly's own.

### `format:` block keeps `objectAnchoredPredicates`

`format:` no longer carries `prefixes` or `base`. It keeps `objectAnchoredPredicates`, which is genuinely format-command-scoped (it shapes Turtle group structure; neither `diff` nor the webapp uses it; tabular diff cannot use it). Future format-command-only knobs slot in alongside it. The "block name = command name" convention is preserved for the rest of the schema; `context:` is the documented carve-out for shared display config.

### Runner threading

The runner's `projectFileLayer` (`apps/cli/src/app/runner/runner.ts`) gains a special-case for `context:` symmetric to the existing `sources:` special-case. When the parsed config carries a `context:` block, the runner unconditionally flattens its keys into the field-level config: `context.prefixes` → field `prefixes`, `context.base` → field `base`. No per-command opt-in via `configScope`. Commands that declare a `prefixes` or `base` field in their `fields` list auto-bind; commands that don't (today: `hash`) silently ignore the values.

This preserves existing handler reads: `format.ts`, `diff.ts`, `query.ts` all already consume `config.prefixes` / `config.base` from their CLI flags. They keep the same reads; the source has just moved.

### Effective prefix map

Every IRI-rendering site applies the same rule:

```
effective = { ...DEFAULT_PREFIXES, ...context.prefixes }
```

`DEFAULT_PREFIXES` (rdf, rdfs, owl, xsd, defined in `libs/common/src/lib/shorten-nquad-line.ts`) is the universal RDF baseline; user prefixes win on conflict. Source-file-loaded prefixes (parsed from `@prefix` headers by `rdf-loader`) do **not** flow into the diff renderer or the webapp — those flow only into `format`'s output via existing `mergePrefixes` logic, where they sit below config prefixes anyway. The webapp diff API does not gain a per-side prefixes payload; the conflict-resolution machinery a per-side payload would require ("whose `ex:` wins when left and right disagree") is unwarranted complexity for a marginal win.

`context.base` is a strict fallback after prefix match. If no prefix matches an IRI and the IRI starts with `context.base`, the renderer emits `<localname>` (relative IRI, Turtle convention). If neither, the IRI emits as `<full IRI>`. Base does not compete with prefixes in longest-match.

### CLI flags removed

`--prefix name=iri`, `--prefixes <json>`, and `--base <iri>` are removed from every command (`format`, `diff`, `query`). The repeatable `name=iri` form was the most ergonomic but still awkward; the JSON-record form (`--prefixes '{"ex":"..."}'`) was actively user-hostile. With `context:` flowing automatically into every consuming command, the CLI surface is zero — display config lives in the project file or it doesn't live.

The one-off case for `--base` (formatting a file under a different base for a preview) is real but weak: a one-line ad-hoc `sparqly.config.yaml` covers it; an env override (e.g. a future `SPARQLY_BASE`) would cover it cleanly. Symmetry beats the lone exception.

### `--context` renames to `--snippet-context`

The `diff` command's `--context K` flag (snippet context lines around a **Source record**) was the dominant prior meaning of "context" in the project. With `context:` taking the unqualified noun, the flag renames to `--snippet-context K` to disambiguate. The renamed flag is the only home; pre-1.0 hard break. CONTEXT.md's **Source-file snippet** definition is updated to speak of "snippet context lines"; "context" without qualifier means the **Context block**.

### Webapp delivery: `/api/sources` → `/api/config`

`GET /api/sources` renames to `GET /api/config`, returning:

```jsonc
{
  "sources": [ { "id": "...", "kind": "...", "label": "...", "default": true } ],
  "context": { "prefixes": { "ex": "..." }, "base": "..." }
}
```

Both fields are registry-wide static state for the lifetime of the `serve` process (config does not reload under `--watch`; only sources do). Bundling them into one payload removes a second boot call from the SPA without forcing future "registry-wide static" additions through their own endpoints. Naming the endpoint `/api/config` reflects the broader scope and matches the in-config block name.

The web side `SourcesService` is renamed to `ConfigService`, exposing `sources()` and `context()` accessors over the single response. The diff renderer takes `context()` as an input and merges with `DEFAULT_PREFIXES` once on the client. ADR-0011's empty-state check in `diff-page.ts` (`(sources() ?? []).length <= 1`) keeps working — it just reads `config().sources` instead.

Single-source mode behaves the same: `/api/config` still serves the response, with `sources` carrying the single entry and `context` carrying whatever the config declares. Empty-config `serve` (no `context:` block) returns `context: { prefixes: {}, base: undefined }`.

### Out of scope for this ADR

- **Yasqe autocomplete** consuming `context.prefixes`. The natural next consumer; out of scope here. Yasgui already manages its own prefix table internally; integration is a separate decision.
- **`${VAR}` substitution on `context:`**. Status quo: substitution stays scoped to `sources:` (per ADR-0010). `context.base` is project-domain identity, not environment-varying. Trivial to extend later if a use case emerges.
- **Per-source prefix overrides**. The block is registry-wide. If a real workload demands per-source prefix overrides (e.g. `sources[].context: { prefixes: { ... } }`), that's a separate amendment.

## Considered alternatives

- **Move `prefixes` and `base` literally to root** (`prefixes:` / `base:` as siblings of `sources:`). Reverses ADR-0010's flat-root rejection. Each future project-wide key would have to pass a name-clash review against every command's flag namespace at root, which is exactly what ADR-0010 set up blocks to avoid. Rejected.
- **Keep them under `format:` and extend `diff` / `serve` to read `format:`**. Zero schema change. Cheapest mechanically. Rejected: the block name encodes a misnomer (`format:` is no longer about the `format` command), the next reader of the schema asks why `diff` reads a block named after a different command, and the "block name = command name" convention silently breaks for one block. CONTEXT.md would need a flagged-ambiguity entry to explain it; better to rename once than to document the exception forever.
- **Literal JSON-LD shape inside the block** (`context: { 'ex': 'http://...', '@base': '...' }`). Recognizable at a glance to anyone who's seen JSON-LD. Rejected: forces YAML quoting on `@`-keys (the `@` is a YAML reserved indicator), interleaves `@base` among prefix entries hurting scan-readability, and constrains future additions to JSON-LD's reserved-keyword space. Block-name analogy carries the JSON-LD nod adequately without the contents committing to it.
- **Move `objectAnchoredPredicates` into `context:` too**. Keeps a single "presentation" block. Rejected: `objectAnchoredPredicates` is Turtle-group-structure config used only by `formatRdf`, not IRI display. Conflating it with `prefixes`/`base` would smear two unrelated concerns under one block. `format:` is the right home; the convention "block name = command name" is preserved everywhere except the explicit `context:` carve-out.
- **Per-command opt-in via `configScope.sharedBlocks: ['context']`**. Explicit; symmetric with the existing block model. Rejected: every IRI-rendering command would opt in (the empty case is `hash`, which doesn't render IRIs), so the explicitness buys boilerplate without buying clarity. Flattening unconditionally treats `context:` as the top-tier layer it actually is.
- **Pass `context` as a nested object on every command's resolved config** (`config.context.prefixes`). Cleanest mental model. Rejected: existing handlers read `config.prefixes` / `config.base` directly; the rename has no payoff and a non-trivial migration cost. Flattening preserves handler-side reads.
- **New `GET /api/context` endpoint** alongside `/api/sources`. Single concern per endpoint. Rejected: bundling into `/api/config` removes one boot call, and "registry-wide static state" is a single concern at the SPA boot tier — there's no consumer of `sources` that doesn't also want `context`, and vice versa.
- **Embed `context` in `POST /api/diff` response** instead of a static endpoint. Rejected: scopes registry-wide config to one command's payload, and other webapp pages (Yasgui playground, eventual query results) would each need their own copy.
- **Keep `--prefix` / `--prefixes` / `--base` as CLI overrides** for ad-hoc use. Rejected: prefixes are project-wide identity, not per-invocation concerns; the JSON-record form is user-hostile; the repeatable form is mildly ergonomic but encourages drifting prefix sets between invocations. Display config lives in `context:` or it doesn't live.
- **Keep `--base` only on `format`**. The lone keep-case (preview formatting under a different base). Rejected: the symmetry of "all three flags go" is cleaner than carrying one exception, and the preview case is satisfied by a one-line scratch config.
- **Source-file-loaded prefixes flow to the renderer**. `format` already merges them. Would require the diff API to gain a per-side prefixes payload. Rejected: per-side prefix maps need conflict resolution rules (whose `ex:` wins?) for a marginal win over `context.prefixes`. If a workload demands it, a separate decision; the door is open.

## Consequences

- **Breaking schema change**: configs putting `prefixes:` or `base:` under `format:` fail validation with a redirect message to `context.prefixes` / `context.base`. The existing root-level rejection of `prefixes` / `base` (which redirected to `format.*`) updates to redirect to `context.*`. Pre-1.0, no compat shim.
- **Breaking CLI change**: `--prefix`, `--prefixes`, `--base` are removed from `format`, `diff`, `query`. Scripts using them break with "unknown option." Migration is a one-shot edit moving the values into `context:`.
- **Breaking CLI change**: `--context K` on `diff` renames to `--snippet-context K`. Scripts and the webapp's `GET /api/source-snippet?context=N` query param both update; pre-1.0 hard rename.
- **Breaking web API change**: `GET /api/sources` becomes `GET /api/config`, response gains a `context` field alongside `sources`. Web `SourcesService` becomes `ConfigService`; the diff page's empty-state check, the diff service, and any test expecting the old endpoint update.
- **Renderer change**: `apps/web/src/app/diff-result-renderer.ts` reads the merged effective prefix map (and base) from a single input, replaces the three `DEFAULT_PREFIXES` call sites. `libs/common/src/lib/shorten-nquad-line.ts`'s `ShortenNQuadLineConfig` extends from `{ prefixes }` to `{ prefixes; base? }`; `bestPrefixEntryFor` is unchanged (base is checked outside it).
- **Runner change**: `projectFileLayer` in `apps/cli/src/app/runner/runner.ts` gains a `context:` flatten step alongside the existing `sources:` step. The runner test suite gains coverage for the flatten + per-command auto-bind shape.
- **Schema change**: `apps/cli/src/app/runner/project-config-schema.ts` adds `contextBlockSchema` with `prefixes` / `base` keys; `formatBlockSchema` shrinks to `objectAnchoredPredicates`; `KNOWN_TOP_LEVEL` gains `'context'`; `ROOT_KEY_DESTINATIONS` redirects update from `format.*` to `context.*` for `prefixes`/`base`.
- **CONTEXT.md** gains a **Context block** definition, an IRI-rendering Relationships entry, and a Flagged-ambiguity entry for the resolved "context" overload; the **Source-file snippet** entry updates to "snippet context lines" and references `--snippet-context K`.
- **Threat surface unchanged**: the new endpoint is a rename of an existing one, the new block carries no path-bearing fields, no env substitution, no remote URL fetches.
- **Migration is one-shot**: existing configs with `format: { prefixes, base }` move to `context: { prefixes, base }`; existing `format:` blocks shrink to `{ objectAnchoredPredicates }` if anything remains, otherwise the block is dropped.
