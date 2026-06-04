# Configuration

Project-stable settings live in a single `sparqly.config.{yaml,yml,json}` at the project root. The file declares the **source registry** plus settings that are stable across many invocations — per-invocation values (output paths, ad-hoc queries, format selection, comparison targets) belong on the CLI, not in the file.

This page covers the file shape, discovery, the top-level blocks, environment variables, and `@id` resolution at the CLI. The source-spec reference (per-kind schema, transforms) lives in [`sources.md`](./sources.md).

Generate a starter file with `sparqly init` — it writes a commented `sparqly.config.yaml` to the current directory.

## File layout

The schema is strict: only a fixed set of top-level keys is accepted, and unknown keys produce errors that name the destination.

```yaml
# sparqly.config.yaml
sources: # source registry (see sources.md)
serve: # serve-command settings
format: # format-command settings
context: # shared IRI-display config (prefixes, base)
describe: # describe-page defaults (serve's webapp)
savedQueries: # saved-query sidecar path (serve's webapp)
index: # disk-backed glob-index settings (serve, index)
query: # in-memory query worker pool (serve)
```

`context:` is the project-wide carve-out: every IRI-rendering command (`query`, `format`, `diff`, `serve`'s webapp) reads it. The other blocks follow the "block name = command name" convention, with `serve` reading the widest set:

| Block          | Read by                                  |
| -------------- | ---------------------------------------- |
| `sources`      | `query`, `serve`, `hash`, `diff`, `format`, `index` |
| `context`      | `query`, `serve`, `format`, `diff`       |
| `serve`        | `serve`                                  |
| `format`       | `format`                                 |
| `describe`     | `serve`                                  |
| `savedQueries` | `serve`                                  |
| `index`        | `serve`, `index`                         |
| `query`        | `serve` (the worker pool — **not** the `query` command) |

The `query:` block configures the in-memory worker pool that `serve` runs; the name collides with the `query` command, but the command itself reads no command-scoped block — every flag it has is per-invocation.

## Discovery

Sparqly walks up from CWD looking for `sparqly.config.{yaml,yml,json}`, stopping at the git root (or filesystem root if there's no repo). The first match wins; two matches in the same directory (e.g. both `sparqly.config.yaml` and `sparqly.config.json`) are an error.

Resolution precedence (highest to lowest): `--config <path>` → `SPARQLY_CONFIG` env → auto-discovered → none. Pass `--no-config` (or `SPARQLY_CONFIG=`) to opt out entirely — useful for one-shot invocations and tests that must ignore the project's defaults.

## Path resolution

Paths inside the config file (`sources[].glob`, `index.dir`) resolve relative to the **config file's directory**. Paths from CLI flags or env vars resolve relative to **CWD**. The split keeps auto-discovery from silently breaking when you invoke from a subdirectory: `glob: data/*.ttl` declared in `~/proj/sparqly.config.yaml` always means `~/proj/data/*.ttl`, regardless of where you run `sparqly` from.

## `sources:`

The source registry. See [`sources.md`](./sources.md) for the full reference: the three user-declarable kinds (`glob`, `endpoint`, `empty`), their schemas, and the `transforms:` pipeline.

## `serve:`

```yaml
serve:
  port: 3000
  watch: true
  watchDebounce: 250
  mutable: false
```

| Field           | Type    | Meaning                                                                                                                                  |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `port`          | integer | HTTP port the server binds to. Default `3000`. Override at runtime with `--port` or `SPARQLY_PORT`.                                      |
| `watch`         | boolean | Watch the served sources' glob/file inputs and rebuild on change. Default `false`. Override at runtime with `--watch`.                   |
| `watchDebounce` | integer | Debounce window for `--watch` rebuilds, in ms. Default `250`. Override at runtime with `--watch-debounce`.                               |
| `mutable`       | boolean | If true, the SPARQL endpoint accepts mutating queries (`UPDATE`/`INSERT`/`DELETE`/`LOAD`) against the in-memory store. Default `false`.  |

All fields are optional; unset fields fall back to their built-in defaults.

`--read-only` is a serve flag only — it refuses writes to the **saved-query sidecar** (`PUT`/`DELETE` return 405) and Sources-page admin actions (Load / Reload / Unload / (Re)build index return 403), and the webapp hides the corresponding controls. It is not config-eligible: pass it on the command line. It is independent of `mutable`, which only gates SPARQL-protocol writes against the in-memory store.

## `format:`

```yaml
format:
  objectAnchoredPredicates:
    - http://www.w3.org/2000/01/rdf-schema#label
```

| Field                      | Type       | Meaning                                                             |
| -------------------------- | ---------- | ------------------------------------------------------------------- |
| `objectAnchoredPredicates` | `string[]` | Predicate IRIs that should anchor object grouping in pretty output. |

`prefixes` and `base` used to live here; they moved to [`context:`](#context). A config that still puts them under `format:` fails validation with a redirect message to `context.prefixes` / `context.base`.

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

There are no CLI overrides for these values — `--prefix`, `--prefixes`, and `--base` were removed across `format`, `diff`, and `query`. Display config lives in `context:` or it doesn't live.

## `describe:`

Defaults for the webapp's describe page. Consumed by `serve` only.

```yaml
describe:
  perSourceSoftLimit: 1000
  perSourceHardLimit: 10000
```

| Field                | Type    | Meaning                                                                                                                                                |
| -------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perSourceSoftLimit` | integer | Per-source quad cap applied when a describe request omits `perSourceLimit`. A source that hits the cap reports `truncated: true` on its response.      |
| `perSourceHardLimit` | integer | Absolute ceiling: a request-supplied `perSourceLimit` larger than this is clamped down to it.                                                         |

All fields are optional.

## `savedQueries:`

The saved-query sidecar that `serve`'s webapp reads and writes. Consumed by `serve` only.

```yaml
savedQueries:
  path: shared/.sparqly-queries.yaml
```

| Field  | Type   | Meaning                                                                                                                       |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `path` | string | Path to the sidecar YAML. Relative paths resolve against the config-file directory. `--read-only` makes the sidecar append-only from the webapp. |

All fields are optional; omitting the block uses the built-in default location.

## `index:`

Disk-backed glob-index settings. Consumed by `serve` (which builds and refreshes on-disk quad indexes for `storage: disk` glob sources in isolated child processes) and by the `index` command (which builds them ahead of time).

```yaml
index:
  dir: .sparqly/index
  concurrency: 2
```

| Field         | Type    | Meaning                                                                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `dir`         | string  | Glob-index cache root. Relative paths resolve against the config-file directory. Defaults to `<configDir>/.sparqly/index/`. |
| `concurrency` | integer | Maximum number of parallel `sparqly index` child builds run at once (the `IndexBuildPool` size). Default `2`.              |

All fields are optional.

## `query:`

In-memory query worker settings. `serve` runs CPU-bound in-memory SPARQL queries off the main event loop in a bounded pool of worker threads, so one heavy query can't freeze other requests. (This block configures `serve`; the `query` command runs a single query in-process and reads nothing here.)

```yaml
query:
  concurrency: 2
  maxResidentQuads: 50000000
  maxOldGenerationSizeMb: 512
```

| Field                    | Type    | Meaning                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `concurrency`            | integer | Number of in-memory query workers in the pool. A source is pinned to one worker by a hash of its id, so its store is built once and reused. Default `2`.                                                                                                                                                                                          |
| `maxResidentQuads`       | integer | Per-worker LRU budget, in quads, for resident stores. When a build pushes a worker over budget it evicts its least-recently-used idle store (a store with an in-flight query is never evicted); a later query for an evicted source rebuilds it transparently on the same worker. Defaults high enough that typical small registries never evict. |
| `cancelGraceMs`          | integer | Grace window (ms) after a query is cancelled (client disconnect) before its worker — if it hasn't torn down the query's stream, i.e. it's stuck in a synchronous stretch — is terminated and respawned. Default `250`.                                                                                                                            |
| `maxOldGenerationSizeMb` | integer | Per-worker V8 old-generation heap ceiling (MB). An over-budget query trips a catchable `ERR_WORKER_OUT_OF_MEMORY` that kills only that worker — a hard backstop under the soft `maxResidentQuads` governor; `serve` survives, in-flight queries fail as a `502`, and the worker respawns. Omitted leaves Node's default (effectively unbounded) heap. |

All fields are optional.

## Environment variables

Sparqly exposes a small env surface — only knobs that vary by environment (CI vs dev, deploy port), not flag mirrors:

| Variable                                 | Purpose                                                              |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `SPARQLY_CONFIG`                         | Config-file path. Empty value opts out (same as `--no-config`).     |
| `SPARQLY_PORT`                           | Override `serve.port` (Twelve-Factor / k8s convention).             |
| `SPARQLY_VERBOSE` / `SPARQLY_QUIET`      | Logging toggles (mirror `--verbose` / `--quiet`).                   |
| `SPARQLY_LOG_FORMAT`                     | Log output format on stderr: `text` or `json` (mirrors `--log-format`). |
| `${VAR}` inside `sources:`               | String substitution — see below.                                   |
| `SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS` | Dev backdoor for `diff` HTML rendering.                             |

### Variable substitution inside `sources:`

Strings anywhere under `sources:` are scanned for `${VAR}` and replaced with the corresponding environment variable. This is the canonical home for per-environment endpoints and credentials:

```yaml
sources:
  - id: fedlex
    endpoint: ${FEDLEX_URL}
    auth: { type: bearer, token: ${FEDLEX_TOKEN} }
```

Rules:

- **Scope.** Substitution applies only inside `sources:`. Other blocks (`serve:`, `format:`, etc.) are taken literally.
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

A `kind: 'reference'` alias (string-form `@id` declared inside `sources:`) is rejected as a target — references are pointers used inside the registry, not data the command can run against.

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
