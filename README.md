<img src="assets/icon.svg" alt="sparqly" width="96" />

# Sparqly

RDF CLI with SPARQL query and an embedded YASGUI playground.

> **Alpha.** Sparqly is in active early development. Commands, flags, config
> shapes, and output formats can change without notice between releases, and
> there is no stability guarantee yet. Pin an exact version if you depend on
> it, and expect to read the changelog before upgrading.

Release notes live in [`CHANGELOG.md`](./CHANGELOG.md).

## Install

Requires Node **22+**. Published to the public npm registry as `sparqly`.

```sh
# stable, global install
npm install -g sparqly
sparqly --help

# pre-release channel (beta dist-tag)
npm install -g sparqly@beta

# ad-hoc, no install
npx sparqly --help
```

Run a one-shot query against a glob of RDF files:

```sh
sparqly query "data/**/*.ttl" -q 'SELECT * WHERE { ?s ?p ?o } LIMIT 10'
```

Boot the playground (Angular UI at `/`, SPARQL endpoint at `/api/sparql`):

```sh
sparqly serve "data/**/*.ttl" --port=3000
# open http://localhost:3000
```

Compute a stable, blank-node-canonical SHA-256 over RDF content, and verify
that a split-then-merged copy still denotes the same graph:

```sh
sparqly hash domain.ttl --compare-with "parts/**/*.ttl"
# match: 4f3c…a1
```

When `hash --compare-with` reports a mismatch, see exactly which triples
drifted with `sparqly diff`:

```sh
sparqly diff domain.ttl "parts/**/*.ttl"
# - <http://example.org/c> <http://example.org/q> <http://example.org/d> .
# + <http://example.org/c> <http://example.org/q> <http://example.org/d2> .
# # +1 -1                                          (on stderr)
```

## Redirecting output to a file (`--out`)

`sparqly query`, `sparqly format`, `sparqly diff`, and `sparqly hash` all
accept `-o, --out <path>` to write the result body to a file instead of
stdout. The bytes written to the file are identical to what would have gone
to stdout; logger output stays on stderr.

```sh
sparqly query "data/**/*.ttl" -q 'SELECT * WHERE { ?s ?p ?o } LIMIT 10' \
  --out results/run.json

sparqly format "data/**/*.ttl" --out formatted.ttl

sparqly diff domain.ttl parts/**/*.ttl --out patch.diff
# stderr still gets the "# +N -M" summary
```

Behavior:

- **Path resolution.** `<path>` is resolved against the current working
  directory. `out` is per-invocation — pass it on the CLI; it is not
  config-eligible and has no env var.
- **Parent directories.** Created automatically (`mkdir -p` semantics).
- **Existing file.** Silently overwritten — no `--force` flag.
- **Atomic write.** Content is written to a sibling `<path>.tmp.<random>`
  and then renamed; readers never observe a partial file.
- **Symlinks.** A symlink at the target is replaced by the rename. There is
  no symlink-following behavior.
- **`--out -`.** Rejected with a clear error; pipe stdout instead.
- **Existing directory at `<path>`.** Rejected with a clear error.

Per-command notes:

- **`format`.** `--out` only applies in stdout mode. It is rejected when
  combined with `--write` or `--check`, both of which already do per-file
  I/O.
- **`hash`.** `--out` is rejected when combined with `--compare-with`, which
  is a comparison mode rather than a body emitter.
- **`diff`.** The trailing `# +N -M` summary still goes to stderr (suppress
  it with `--quiet`); only the diff body is redirected.

## Configuration

Project-stable settings live in a single `sparqly.config.{yaml,yml,json}` at
the project root. The file declares the **source registry** plus settings
that are stable across many invocations — per-invocation values (output
paths, ad-hoc queries, format selection, comparison targets) belong on the
CLI, not in the file.

### File layout

One whole-project schema validates the entire file regardless of which
command loaded it. Top-level `sources:` plus command-scoped blocks
(`serve:`, `format:`, `cache:`); unknown top-level keys are rejected.

```yaml
# sparqly.config.yaml
sources:
  - id: domain
    glob: 'data/**/*.ttl'
    default: true
  - id: fedlex
    endpoint: https://fedlex.data.admin.ch/sparqlendpoint
    auth: { type: bearer, token: ${FEDLEX_TOKEN} }

serve:
  port: 3000
  watch: true
  mutable: false

format:
  prefixes:
    ex: http://example.org/
  base: http://example.org/

cache:
  dir: .sparqly-cache
```

Each command reads only the sections it cares about: `query` / `hash` /
`diff` read `sources`; `serve` reads `sources` + `serve`; `format` reads
`sources` + `format`; `cache list` / `cache clear` read `cache`. `query`
has no command-scoped block — every flag it has is per-invocation. The full
schema lives in
[ADR-0010](docs/adr/0010-project-config-scope-layout-and-discovery.md).

### Discovery

Sparqly walks up from CWD looking for `sparqly.config.{yaml,yml,json}`,
stopping at the git root (or filesystem root if there's no repo). The first
match wins; two matches in the same directory (e.g. both
`sparqly.config.yaml` and `sparqly.config.json`) are an error.

Resolution precedence (highest to lowest): `--config <path>` →
`SPARQLY_CONFIG` env → auto-discovered → none. Pass `--no-config` (or
`SPARQLY_CONFIG=`) to opt out entirely — useful for one-shot invocations
and tests that must ignore the project's defaults.

### Path resolution

Paths inside the config file (`sources[].glob`, `sources[].queryFile`,
`cache.dir`) resolve relative to the **config file's directory**. Paths
from CLI flags or env vars resolve relative to **CWD**. The split keeps
auto-discovery from silently breaking when you invoke from a subdirectory:
`glob: data/*.ttl` declared in `~/proj/sparqly.config.yaml` always means
`~/proj/data/*.ttl`, regardless of where you run `sparqly` from.

### Environment variables

Sparqly exposes a small env surface — only knobs that vary by environment
(CI vs dev, deploy port, secret credentials), not flag mirrors:

| Variable                                  | Purpose                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `SPARQLY_CONFIG`                          | Config-file path. Empty value opts out (same as `--no-config`).      |
| `SPARQLY_CACHE_DIR`                       | Override `cache.dir` (CI-vs-dev cache location).                     |
| `SPARQLY_PORT`                            | Override `serve.port` (Twelve-Factor / k8s convention).              |
| `SPARQLY_VERBOSE` / `SPARQLY_QUIET`       | Logging toggles.                                                     |
| `${VAR}` inside `sources:`                | String substitution for per-environment endpoints / credentials.     |
| `SPARQLY_DEBUG_PAUSE_BEFORE_SNIPPETS_MS`  | Dev backdoor for `diff` HTML rendering.                              |

Per-command flag-mirrors (`SPARQLY_DIFF_FORMAT`, `SPARQLY_HASH_JSON`,
`SPARQLY_<CMD>_VERBOSE`, `SPARQLY_OUT`, `SPARQLY_GRAPH_MODE`, ...) were
removed in the pre-1.0 cleanup — pass these on the CLI instead.

### Migration from older configs

The schema is strict and surfaces clear destination pointers in its error
messages:

- Per-invocation keys at root (`out`, `query`, `format`, `compareWith`,
  `left`, `right`, `write`, `check`, `context`, `skipAutoSourceAnnotation`,
  `json`) are rejected with a "pass `--<flag>` on the command line instead"
  pointer.
- Block-misplaced keys (`port`, `watch`, `watchDebounce`, `watchPoll`,
  `mutable`, `prefixes`, `base`, `objectAnchoredPredicates`, `cacheDir`)
  are rejected with a "move to `serve.port` / `format.prefixes` /
  `cache.dir` / ..." pointer.

This is a pre-1.0 hard break with no compat shims, matching the precedent
set by the `annotate` → `annotateSource` rename — the schema's error
messages name the destination block, so migration is a one-shot edit.

## `sparqly hash`

`sparqly hash` computes a stable SHA-256 over the **canonicalized** RDF content
of one or more sources, using [RDFC-1.0](https://www.w3.org/TR/rdf-canon/) for
blank-node canonicalization. The hash is invariant under blank-node relabeling,
statement reordering, prefix changes, and other serialization-level differences,
so a `.ttl` file and its split-then-merged equivalent produce the same hash
whenever they actually denote the same RDF graph.

Supported formats are everything the loader already accepts: Turtle, N-Triples,
N-Quads, TriG, JSON-LD, and RDF/XML.

> **Known limitation.** RDFC-1.0 does not normalize literal lexical forms, so
> `"01"^^xsd:integer` and `"1"^^xsd:integer` hash differently even though they
> denote the same value. Same for `"1.0"` vs `"1.00"`, language-tag casing, etc.
> This is acceptable for the primary split/merge workflow as long as the
> splitter does not rewrite literals. Tracked in `ideas.md`.

> **Determinism caveat (SPARQL endpoints).** `hash` always materializes its
> sources, so a SPARQL endpoint source is rejected unless an explicit
> `prefilter` (or `prefilterFile`) is configured to scope the data being
> canonicalized. Even with a prefilter, a remote endpoint can return different
> data between two runs (live data, eventual consistency, missing `ORDER BY`),
> so a `hash --compare-with` against a SPARQL source is only as deterministic
> as the endpoint itself.

### Synopsis

```sh
sparqly hash [glob]
            [-s, --sources <glob>]...
            [--json]
            [--compare-with <source>]
            [--config <path>] [--no-config]
            [-v, --verbose] [--quiet]
```

Graph-name semantics on a quad-bearing source are configured per-source via
the `graphName` transform in the source registry (see ADR-0006); there is
no top-level `--graph-mode` flag.

### Primary workflow: split → merge round-trip

Record a fingerprint of the curated source, then verify that a split into per-topic
files round-trips back to the same content:

```sh
# 1. Record a known-good fingerprint of the unsplit source
sparqly hash domain.ttl
# 4f3c…a1  domain.ttl

# 2. Hash the split parts as a single merged store
sparqly hash "parts/**/*.ttl"
# 4f3c…a1  parts/**/*.ttl

# 3. Or do both in one shot — exits 0 on match, 1 on mismatch
sparqly hash domain.ttl --compare-with "parts/**/*.ttl"
# match: 4f3c…a1
```

Wire step 3 into a publish script or CI step to fail loudly if the split has
drifted from the merged source.

### Multiple sources and JSON output

A glob always merges into a **single** hash. To get multiple hashes in one
invocation, pass `--sources` repeatedly — each `--sources` is its own unit of
identity:

```sh
sparqly hash --sources domain.ttl --sources "vocab/**/*.ttl"
# 4f3c…a1  domain.ttl
# 9b22…ee  vocab/**/*.ttl

sparqly hash --sources domain.ttl --sources "vocab/**/*.ttl" --json
# [{"source":"domain.ttl","hash":"4f3c…a1"},{"source":"vocab/**/*.ttl","hash":"9b22…ee"}]
```

### Exit codes

| Mode             | Code | Meaning                                                            |
| ---------------- | ---- | ------------------------------------------------------------------ |
| default          | 0    | All sources hashed successfully.                                   |
| default          | 1    | Load, parse, or canonicalization failure (no partial results).     |
| `--compare-with` | 0    | Both sides canonicalize to the same hash. Stdout: `match: <hash>`. |
| `--compare-with` | 1    | Hashes differ. Stdout: `<hash>  <source-spec>` for each side.      |
| `--compare-with` | 2    | Load, parse, or canonicalization failure on either side.           |

### Config

`sparqly hash` resolves its target from the [`sources:` registry](#configuration);
it has no command-scoped block — `--json` and `--compare-with` are
per-invocation flags, passed on the CLI. See the
[Configuration section](#configuration) for project-level settings, env
vars, and discovery.

## `sparqly diff`

`sparqly diff <left> <right>` is the natural follow-up to `hash --compare-with`:
when the hashes differ, `diff` shows you exactly which triples or quads drifted.
Both sides are loaded through the same RDF loader and canonicalized via
[RDFC-1.0](https://www.w3.org/TR/rdf-canon/), so the diff is invariant under
blank-node relabeling, statement ordering, prefix declarations, and whitespace.

By convention:

- **added** = statements present in `<right>` but not in `<left>`
- **removed** = statements present in `<left>` but not in `<right>`

The diff is a pure set difference over canonical N-Quads — no move/rename
detection, no fuzzy matching, no SHACL-aware equivalence.

> **Known limitation.** RDFC-1.0 does not normalize literal lexical forms, so
> `"01"^^xsd:integer` vs `"1"^^xsd:integer`, `"1.0"` vs `"1.00"`, or
> language-tag casing will appear as both an addition and a removal even though
> they denote the same value. Tracked in `ideas.md` (shared with `hash`).

> **Determinism caveat (SPARQL endpoints).** `diff` always materializes both
> sides, so a SPARQL endpoint source is rejected on either side unless an
> explicit `prefilter` (or `prefilterFile`) is configured to scope the data
> being compared. Even with a prefilter, a remote endpoint can return different
> data between two runs (live data, eventual consistency, missing `ORDER BY`),
> so a `diff` against a SPARQL source is only as deterministic as the endpoint
> itself.

### Synopsis

```sh
sparqly diff [left] [right]
            [--left <source>] [--right <source>]
            [-f, --format <human|json|rdf-patch>]
            [--config <path>] [--no-config]
            [-v, --verbose] [--quiet]
```

Each side may be a single file path or a glob, and accepts the same RDF
formats as the rest of the CLI (Turtle, N-Triples, N-Quads, TriG, JSON-LD,
RDF/XML).

### Output formats

| Flag                       | Output                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (default) `--format human` | `- <s> <p> <o> [g] .` for removals, `+ <s> <p> <o> [g] .` for additions, in canonical N-Triples / N-Quads order. Removals first.                          |
| `--format json`            | A single JSON object `{"added": [...], "removed": [...]}`. Each statement is `{ s, p, o, g? }`; each term is `{ termType, value, datatype?, language? }`. |
| `--format rdf-patch`       | Standard [RDF Patch](https://afs.github.io/rdf-patch/) text format with `D` markers for deletions and `A` markers for additions.                          |

A trailing `# +<additions> -<removals>` summary line is written to **stderr**
after the diff body, regardless of format. stdout stays cleanly parseable;
suppress the summary with `--quiet` when you need pure machine-consumable
output.

### Exit codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Sources are semantically identical (no added or removed statements).            |
| 1    | Sources differ. The diff is on stdout.                                          |
| 2    | Load, parse, or canonicalization error on either side. Error message on stderr. |

### Graph names

Graph-name semantics on a quad-bearing source (preserve / fillDefault /
forceAll / flatten) are configured per-source via the `graphName` transform
on the source's `transforms:` pipeline (see
[ADR-0006](docs/adr/0006-glob-source-transforms-and-rdf-star-annotations.md)).
The default `preserve` keeps graph names as part of statement identity, so
`<s,p,o,g1>` and `<s,p,o,g2>` are reported as one removal + one addition;
declare `transforms: [{ graphName: flatten }]` on a glob source to coerce it
to the default graph before diffing.

### Config

`sparqly diff` resolves each side from the [`sources:` registry](#configuration);
it has no command-scoped block — `--left`, `--right`, and `--format` are
per-invocation flags, passed on the CLI. See the
[Configuration section](#configuration) for project-level settings, env
vars, and discovery.

## Workspace layout

This is an Nx monorepo managed with pnpm.

| Path          | Kind        | Purpose                                                                                        |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `apps/cli`    | NestJS app  | `sparqly` bin — `nest-commander` entry point, dispatches `query`, `serve`, `hash`, and `diff`. |
| `apps/web`    | Angular app | Browser playground (Angular 21 + Tailwind 4) hosting an embedded YASGUI.                       |
| `libs/core`   | TypeScript  | Comunica wrapper, n3.js store, RDF loader, RDFC-1.0 canonicalizer, immutability guard.         |
| `libs/domain` | TypeScript  | DTOs and types shared between the server and the web app.                                      |
| `libs/server` | TypeScript  | NestJS HTTP module (`ServerModule`, `/api/sparql`) that only boots under `serve`.              |

## Prerequisites

- Node **22+** (pinned to `24.15.0` via Volta; see `package.json`)
- pnpm **8+**

Node version is also enforced by `.npmrc` (`use-node-version=24.15.0`), so pnpm
subprocesses run against the same version regardless of what's on `$PATH`.

## Setting up the workspace

```sh
pnpm install
```

## Common tasks

```sh
pnpm exec nx run-many -t build lint test    # full workspace
pnpm exec nx build cli                       # build the sparqly CLI
pnpm exec nx test core                       # run core unit tests
pnpm exec nx serve web                       # Angular dev server (see below)
```

## Running the CLI locally

Build once, then invoke the bundle:

```sh
pnpm exec nx build cli
node dist/apps/cli/main.js --help
node dist/apps/cli/main.js query --help
node dist/apps/cli/main.js serve --help
```

Once published (`npm i -g sparqly`), the same entry point is exposed as the
`sparqly` bin.

## Dev server vs bundled-in-CLI

There are **two** ways to run the web UI, and they must not be confused.

### Dev: `nx serve web` + a running `sparqly serve`

During development the Angular app runs in its own dev server (fast rebuilds,
HMR). `sparqly serve` boots the HTTP API separately. The Angular dev server
proxies `/api/*` to the running `sparqly serve` (see
[`apps/web/proxy.conf.json`](apps/web/proxy.conf.json)) — do **not** serve the
dev bundle from the CLI.

In two terminals:

```sh
# terminal 1 — SPARQL endpoint on :3000
node dist/apps/cli/main.js serve "test/data/**/*.ttl" --port=3000

# terminal 2 — Angular dev server on :4200, proxies /api/* to :3000
pnpm exec nx serve web
```

```
┌─────────────┐   HTTP        ┌───────────────────┐
│  browser    │ ───────────▶  │ ng dev server     │
└─────────────┘               │  (Angular HMR)    │
                              │                   │
                              │  proxy /api/* ─▶  │ ──▶ sparqly serve (NestJS, :3000)
                              └───────────────────┘
```

### Prod: `sparqly serve` alone

For shipping, `apps/web` is built and its output is bundled **inside the CLI
package** at `dist/apps/cli/web/` (driven by `apps/cli`'s build depending on
`web:build`). `sparqly serve` then serves both the static app at `/` and the
SPARQL endpoint at `/api/sparql` from a single process — no extra tooling
required after `npm i -g sparqly`.

```
┌─────────────┐   HTTP        ┌───────────────────────────────────────┐
│  browser    │ ───────────▶  │ sparqly serve (NestJS, :3000)         │
└─────────────┘               │   /             → Angular bundle       │
                              │   /api/sparql   → SPARQL Protocol      │
                              └───────────────────────────────────────┘
```

## License

MIT
