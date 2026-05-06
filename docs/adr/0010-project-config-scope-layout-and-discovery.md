# Project config scope, layout, and discovery

## Status

Accepted.

## Context

The config file (`sparqly.config.{yaml,yml,json}`) had drifted into a soup of every flag on every command. Each command built its own strict Zod schema from its full field list, so any flag — `--out`, `--query`, `--format`, `--write`, `--check`, `--compare-with`, `--left`, `--right`, `--context`, `--skip-auto-source-annotation`, etc. — could legally appear at the root of the file. In parallel, ~38 `SPARQLY_*` env vars existed, mostly auto-generated mirrors of every per-command flag (e.g. `SPARQLY_DIFF_LEFT`, `SPARQLY_HASH_QUERY`, `SPARQLY_FORMAT_OUT`, `SPARQLY_<CMD>_VERBOSE` for every command). Per-invocation values had crept into both layers without a principle for what belongs where.

The file also wasn't really a project config: each command parsed the file against its own schema, so a `port` key at the root was rejected by every command other than `serve`, and a single shared file across commands wasn't actually possible. Discovery was explicit-only — a config sitting next to the user was ignored unless `--config` or `SPARQLY_CONFIG` was supplied.

## Decision

The config file's job is to declare the **source registry** plus settings that are stable per project across many invocations. Per-invocation flags (output paths, ad-hoc queries, format selection, comparison targets, side selectors, write/check toggles) are not config-eligible regardless of which command they attach to. Env vars are scoped to environment-level concerns (where am I running, what's my deploy port, where does the cache live), not flag mirrors.

### Layout

One whole-project Zod schema validates the entire file regardless of which command loaded it. Top-level `sources:` plus command-scoped blocks:

```yaml
sources:
  - id: fedlex
    endpoint: https://fedlex.data.admin.ch/sparqlendpoint

serve:
  port: 3000
  mutable: false
  watch: true
  watchDebounce: 250
  watchPoll: 1000

format:
  prefixes:
    ex: http://example.org/
  base: http://example.org/
  objectAnchoredPredicates: [rdfs:label]

cache:
  dir: .sparqly-cache
```

Each command reads only the section(s) relevant to it (`query` / `hash` / `diff` → `sources`; `serve` → `sources` + `serve`; `format` → `sources` + `format`; `cache list` / `cache clear` → `cache`). Unknown top-level keys are rejected by the whole-project schema. `query` carries no command-scoped block — every flag it has is per-invocation.

The per-source `cache:` field on a view (Result cache config: `ttl` / `freshness` / `everlasting`) and the new top-level `cache:` block (`dir`) intentionally share a name: they are at different scopes (file root vs inside a source object) and are semantically related — per-source result caches write into top-level `cache.dir`.

### Discovery

Walk up from CWD to the first `sparqly.config.{yaml,yml,json}` (stop at git root, falling back to filesystem root). Resolution precedence: `--config` flag > `SPARQLY_CONFIG` env > auto-discovered > none. `--no-config` (or empty `SPARQLY_CONFIG`) opts out entirely, for one-shot invocations and tests that must ignore the project's defaults. Multiple matches in the same directory (`sparqly.config.yaml` *and* `sparqly.config.json`) are an error.

### Path resolution

Paths read from the config file resolve relative to the config file's directory. Paths from CLI flags or env vars resolve relative to CWD. The split exists because each layer has its own mental origin: the config file lives somewhere fixed, the shell lives at CWD. Without the split, auto-discovery silently breaks: a `glob: data/*.ttl` declared in `~/proj/sparqly.config.yaml` would mean different files depending on which subdirectory the user invoked from.

Resolution is eager — `file-loader.ts` rewrites path-bearing config fields (`sources[].glob`, `sources[].queryFile`, `cache.dir`) to absolute paths immediately after parse, alongside the existing `${VAR}` substitution pass. Env and CLI layers stay raw and resolve against CWD when consumed.

### Env vars

Keepers (~9):

- `SPARQLY_CONFIG` — bootstrap, can't self-reference
- `SPARQLY_CACHE_DIR` — CI-vs-dev cache override
- `SPARQLY_VERBOSE` / `SPARQLY_QUIET` — common debug-cycle pattern
- `SPARQLY_PORT` — Twelve-Factor / k8s convention; overrides `serve.port`
- `${VAR}` substitution in `sources:` (`substituteSourceEnv`) — per-environment endpoints/credentials
- `SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS` — dev backdoor in `diff.ts`

Dropped (~29):

- All per-command mirrors of cross-cutting flags (`SPARQLY_<CMD>_VERBOSE`, `SPARQLY_<CMD>_QUIET`, `SPARQLY_<CMD>_OUT`, `SPARQLY_<CMD>_GRAPH_MODE`, `SPARQLY_<CMD>_MUTABLE`)
- All per-flag env mirrors of per-invocation flags (`SPARQLY_DIFF_LEFT`/`RIGHT`/`QUERY*`/`FORMAT`/`CONTEXT`/`SKIP_AUTO_SOURCE_ANNOTATION`, `SPARQLY_HASH_COMPARE_WITH*`/`QUERY*`/`JSON`, `SPARQLY_QUERY_QUERY*`/`FORMAT`, `SPARQLY_FORMAT_WRITE`/`CHECK`/`OUT`)
- `SPARQLY_OUT` — output paths are per-invocation
- `SPARQLY_GRAPH_MODE` — see below
- `SPARQLY_MUTABLE` — `serve.mutable` lives in config; `query --mutable` is CLI-only
- `SPARQLY_WATCH` / `SPARQLY_WATCH_DEBOUNCE` / `SPARQLY_WATCH_POLL` (and `SPARQLY_SERVE_*` mirrors) — dev-loop tuning has no env case

### `--graph-mode` removed

The top-level `--graph-mode` flag (and `SPARQLY_GRAPH_MODE` env) is removed. The **Graph-name transformation** (`graphName: preserve | fillDefault | forceAll | flatten`) on a glob source's `transforms:` pipeline is the canonical and only home for graph-name semantics, matching the existing CONTEXT.md entry. A top-level command override silently mutated resolution semantics across the whole registry, which is exactly the foot-gun the per-source transform model was introduced to prevent.

## Considered alternatives

- **Per-command schemas** (status quo logic, formalized). Each command keeps its own strict schema; a `serve:` block is rejected by `query`. Forces per-command config files (`sparqly.serve.yaml`, `sparqly.format.yaml`) and re-introduces, structurally, the soup we cleaned up. Rejected.
- **Flat top-level layout** (no `serve:` / `format:` / `cache:` blocks; everything at root). Works for the current key set but every project-stable key added in the future must pass a name-clash review against every other command. Rejected for B's structural ownership.
- **Explicit-only discovery** (no walk-up). Predictable and no magic, but defeats "the project's config" once auto-load conventions are universal in this neighborhood (eslint, prettier, biome, vitest). Rejected.
- **Always-CWD path resolution** for config-file paths. Status quo. Trivially compatible with explicit `--config` from a fixed dir, but combined with auto-discovery it silently breaks every glob/queryFile/cacheDir when the user invokes from a subdirectory. Rejected.
- **Always-config-relative paths everywhere**, including CLI flags. Cleaner in one sense but breaks the `./` convention every shell user has — `--query-file ./scope.rq` from a subdir would resolve against the (possibly distant) config file. Rejected.
- **Lazy path resolution at use-site** (carry origin tags through merge, resolve when read). `mergeLayers` already tracks origin per key, so this is mechanically possible — but spreads the file-vs-CWD rule across every consumer. Rejected for eager: localizes the rule to one file (`file-loader.ts`), keeps everything downstream string-based.
- **Keep flag-mirror env vars** for consistency. Argued by Twelve-Factor "config in env" purism. Rejected: per-invocation values don't belong in the environment by the same principle that excluded them from config; the mirrors were boilerplate from `verbosityFieldsFor` / `outFieldFor`, not a designed surface.
- **Graph-mode override** as project-wide CLI flag (option 2 from the grilling). Would make CONTEXT.md's "the canonical home" claim false and re-introduce a silent registry-wide mutator. Rejected.

## Consequences

- Existing configs that put per-invocation keys (`out`, `query`, `format`, `write`, `check`, `compareWith`, `left`, `right`, `context`, `skipAutoSourceAnnotation`, `json`) at the root fail the new schema with a clear path-and-message. Same for top-level `port` / `watch*` / `mutable` / `prefixes` / `base` / `objectAnchoredPredicates` / `cacheDir` — these move under their respective blocks.
- `--graph-mode` callers and any `SPARQLY_GRAPH_MODE` deployments break; semantics move onto the source via `transforms: [{ graphName: ... }]`.
- Auto-discovery means *every* `sparqly` invocation under a project tree picks up the config. `--no-config` / `SPARQLY_CONFIG=` is the documented opt-out.
- Pre-1.0 hard break, no compat shims — matches the precedent set by **annotateSource** (renamed from `annotate` per ADR-0006 / CONTEXT.md flagged-ambiguity notes). Migration is a one-shot edit to existing configs; the schema's error messages name the destination block.
- Path-bearing config fields are absolute strings by the time downstream code sees them. New path-bearing keys added later must be normalized in the same `file-loader.ts` pass.
