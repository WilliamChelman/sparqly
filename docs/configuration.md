# Configuration

Project-stable settings live in a single `sparqly.config.{yaml,yml,json}` at the project root. The file declares the **source registry** plus settings that are stable across many invocations — per-invocation values (output paths, ad-hoc queries, format selection, comparison targets) belong on the CLI, not in the file.

This page covers the file shape, discovery, the five top-level blocks, environment variables, and `@id` resolution at the CLI. The source-spec reference (per-kind schema, transforms, view caching) lives in [`sources.md`](./sources.md).

## File layout

The schema is strict: only five top-level keys are accepted, and unknown keys produce errors that name the destination.

```yaml
# sparqly.config.yaml
sources: # source registry (see sources.md)
serve: # serve-command settings
format: # format-command settings
cache: # cache-block settings
context: # shared IRI-display config (prefixes, base)
```

`context:` is the project-wide carve-out: every IRI-rendering command (`query`, `format`, `diff`, `serve`'s webapp) reads it. The other blocks follow the "block name = command name" convention: `serve` reads `sources` + `serve` + `context`; `format` reads `sources` + `format` + `context`; `query` / `diff` read `sources` + `context`; `hash` reads `sources`; `cache list` / `cache clear` read `cache`. `query` has no command-scoped block — every flag it has is per-invocation. The whole-file schema design lives in [ADR-0010](./adr/0010-project-config-scope-layout-and-discovery.md); the `context:` carve-out is [ADR-0012](./adr/0012-context-block-shared-display-config.md).

## Discovery

Sparqly walks up from CWD looking for `sparqly.config.{yaml,yml,json}`, stopping at the git root (or filesystem root if there's no repo). The first match wins; two matches in the same directory (e.g. both `sparqly.config.yaml` and `sparqly.config.json`) are an error.

Resolution precedence (highest to lowest): `--config <path>` → `SPARQLY_CONFIG` env → auto-discovered → none. Pass `--no-config` (or `SPARQLY_CONFIG=`) to opt out entirely — useful for one-shot invocations and tests that must ignore the project's defaults.

## Path resolution

Paths inside the config file (`sources[].glob`, `sources[].queryFile`, `cache.dir`) resolve relative to the **config file's directory**. Paths from CLI flags or env vars resolve relative to **CWD**. The split keeps auto-discovery from silently breaking when you invoke from a subdirectory: `glob: data/*.ttl` declared in `~/proj/sparqly.config.yaml` always means `~/proj/data/*.ttl`, regardless of where you run `sparqly` from.

## `sources:`

The source registry. See [`sources.md`](./sources.md) for the full reference: the four user-declarable kinds (`glob`, `endpoint`, `view`, `empty`), their schemas, the `transforms:` pipeline, and view caching.

## `serve:`

```yaml
serve:
  port: 3000
  watch: true
  watchDebounce: 250
  watchPoll: 1000
  mutable: false
```

| Field           | Type    | Meaning                                                                                                                |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `port`          | integer | HTTP port the server binds to. Default `3000`. Override at runtime with `--port` or `SPARQLY_PORT`.                    |
| `watch`         | boolean | Watch the target's chain (globs and any `cache.ttl` / `cache.freshness` views) and rebuild on change. Default `false`. |
| `watchDebounce` | integer | Debounce window for `--watch` rebuilds, in ms. Default `250`.                                                          |
| `watchPoll`     | integer | Poll interval (ms) for cache-freshness ASK probes under `--watch`. Default `1000`.                                     |
| `mutable`       | boolean | If true, the SPARQL endpoint accepts `INSERT` / `DELETE` against the in-memory store.                                  |

All fields are optional; unset fields fall back to their built-in defaults.

## `format:`

```yaml
format:
  objectAnchoredPredicates:
    - http://www.w3.org/2000/01/rdf-schema#label
```

| Field                      | Type       | Meaning                                                             |
| -------------------------- | ---------- | ------------------------------------------------------------------- |
| `objectAnchoredPredicates` | `string[]` | Predicate IRIs that should anchor object grouping in pretty output. |

`prefixes` and `base` used to live here; they moved to [`context:`](#context) (ADR-0012). A config that still puts them under `format:` fails validation with a redirect message to `context.prefixes` / `context.base`.

## `context:`

Shared IRI-display config consumed by every command that renders IRIs (`query`, `format`, `diff`) and by the webapp's diff renderer.

```yaml
context:
  prefixes:
    ex: http://example.org/
    schema: http://schema.org/
  base: http://example.org/
```

| Field      | Type                     | Meaning                                                                                                                       |
| ---------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `prefixes` | `Record<string, string>` | Prefix → IRI namespace map. Merged on top of the universal RDF baseline (rdf, rdfs, owl, xsd); user prefixes win on conflict. |
| `base`     | string                   | Strict fallback after prefix match — IRIs starting with `base` emit as `<localname>`.                                         |

Both fields are optional; an empty `context:` block is legal and equivalent to omitting it. The block is named after JSON-LD's `@context` for the prefix-map + base semantic, but the contents use sparqly-internal subkeys.

There are no CLI overrides for these values — `--prefix`, `--prefixes`, and `--base` were removed across `format`, `diff`, and `query`. Display config lives in `context:` or it doesn't live (ADR-0012).

## `cache:`

```yaml
cache:
  dir: .sparqly-cache
```

| Field | Type   | Meaning                                                                                    |
| ----- | ------ | ------------------------------------------------------------------------------------------ |
| `dir` | string | Directory holding view-cache entries. Override per-view with `cache.cacheDir` on the view. |

`SPARQLY_CACHE_DIR` overrides this at runtime (useful for switching between CI and dev cache locations).

## Environment variables

Sparqly exposes a small env surface — only knobs that vary by environment (CI vs dev, deploy port, secret credentials), not flag mirrors:

| Variable                                 | Purpose                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `SPARQLY_CONFIG`                         | Config-file path. Empty value opts out (same as `--no-config`). |
| `SPARQLY_CACHE_DIR`                      | Override `cache.dir`.                                           |
| `SPARQLY_PORT`                           | Override `serve.port` (Twelve-Factor / k8s convention).         |
| `SPARQLY_VERBOSE` / `SPARQLY_QUIET`      | Logging toggles.                                                |
| `${VAR}` inside `sources:`               | String substitution — see below.                                |
| `SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS` | Dev backdoor for `diff` HTML rendering.                         |

### Variable substitution inside `sources:`

Strings anywhere under `sources:` are scanned for `${VAR}` and replaced with the corresponding environment variable. This is the canonical home for per-environment endpoints and credentials:

```yaml
sources:
  - id: fedlex
    endpoint: ${FEDLEX_URL}
    auth: { type: bearer, token: ${FEDLEX_TOKEN} }
```

Rules:

- **Scope.** Substitution applies only inside `sources:`. Other blocks (`serve:`, `format:`, `cache:`) are taken literally.
- **Missing variable.** A reference to an unset `${VAR}` is an error; the message points at the JSON-pointer location inside `sources:`. Sparqly fails closed rather than silently producing an empty endpoint URL.
- **Empty variable.** A reference to `${VAR}=""` is also an error, for the same reason.
- **Escaping.** Use `$${VAR}` to emit a literal `${VAR}` without expansion.

## `@id` resolution at the CLI

Commands that take a source target accept either a literal value or an `@id` ref:

```sh
sparqly query "data/**/*.ttl" -q '...'      # inline glob (string-shorthand)
sparqly query https://example.org/sparql    # inline endpoint URL
sparqly query @recent-acts                  # @id ref into the registry
sparqly query                               # no target → use `default: true`
```

Target precedence (highest to lowest):

1. Explicit positional / flag (`@id`, inline glob, or inline URL).
2. The registry entry marked `default: true`.
3. The sole registry entry, when there is exactly one.
4. Otherwise: error, listing available `@id`s.

A `kind: 'reference'` alias (string-form `@id` declared inside `sources:`) is rejected as a target — references are pointers used inside `from:`, not data the command can run against.

## Cross-command flags

### Redirecting output to a file (`--out`)

`sparqly query`, `sparqly format`, `sparqly diff`, and `sparqly hash` all accept `-o, --out <path>` to write the result body to a file instead of stdout. The bytes written to the file are identical to what would have gone to stdout; logger output stays on stderr.

```sh
sparqly query "data/**/*.ttl" -q 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' \
  --out results/run.json

sparqly format "data/**/*.ttl" --out formatted.ttl

sparqly diff domain.ttl parts/**/*.ttl --out patch.diff
# stderr still gets the "# +N -M" summary
```

Behavior:

- **Path resolution.** `<path>` is resolved against the current working directory. `--out` is per-invocation — pass it on the CLI; it is not config-eligible and has no env var.
- **Parent directories.** Created automatically (`mkdir -p` semantics).
- **Existing file.** Silently overwritten — no `--force` flag.
- **Atomic write.** Content is written to a sibling `<path>.tmp.<random>` and then renamed; readers never observe a partial file.
- **Symlinks.** A symlink at the target is replaced by the rename. There is no symlink-following behavior.
- **`--out -`.** Rejected with a clear error; pipe stdout instead.
- **Existing directory at `<path>`.** Rejected with a clear error.

Per-command notes:

- **`format`.** `--out` only applies in stdout mode. It is rejected when combined with `--write` or `--check`, both of which already do per-file I/O.
- **`hash`.** `--out` is rejected when combined with `--compare-with`, which is a comparison mode rather than a body emitter.
- **`diff`.** The trailing `# +N -M` summary still goes to stderr (suppress it with `--quiet`); only the diff body is redirected.
