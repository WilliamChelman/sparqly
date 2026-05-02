<img src="assets/icon.svg" alt="sparqly" width="96" />

# Sparqly

RDF CLI with SPARQL query and an embedded YASGUI playground.

See [PRD #1](https://github.com/WilliamChelman/sparqly/issues/1) for the v1 scope.
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
  directory regardless of where it was set (CLI flag, `SPARQLY_OUT` /
  `SPARQLY_<COMMAND>_OUT`, or `out:` in a `sparqly.<command>.yaml` config
  file).
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

`out` also resolves through the standard config layer — it can be set as a
top-level `out:` key in the per-command config file (e.g. `sparqly.query.yaml`),
or via the `SPARQLY_OUT` / `SPARQLY_<COMMAND>_OUT` environment variables, with
the same precedence as every other option.

## Configuration file

Each command reads its own per-command config file so you don't have to repeat
`--sources`, `--graph-mode`, `--port`, etc. on every invocation. There is
**no auto-discovery**: a config file is loaded only when you point at one
explicitly via `--config <path>` or the `SPARQLY_CONFIG` environment variable.
`--config` wins when both are set; a missing, unreadable, or unparseable path
is a hard error.

The conventional filename is `sparqly.<command>.{yaml,yml,json}` (e.g.
`sparqly.query.yaml`, `sparqly.diff.json`), but the runner does not enforce
the name — `--config ./my-conf.yaml` works.

### Schema

Each file is **flat**: top-level keys map directly to that command's options.
There is no `extends:`, no shared block, and no per-command sub-blocks. Unknown
keys are a hard validation error. Every option exposed as a CLI flag for the
command is expressible in the file.

```yaml
# sparqly.query.yaml
sources: 'data/**/*.ttl'
graphMode: preserve # preserve | fillDefault | forceAll | flatten
mutable: false
query: |
  SELECT ?s ?p ?o
  WHERE { ?s ?p ?o }
  LIMIT 10
# queryFile: ./queries/default.rq  # mutually exclusive with `query`
format: json # json | turtle
```

```yaml
# sparqly.serve.yaml
sources: 'data/**/*.ttl'
port: 3000
watch: true
watchDebounce: 250
mutable: true
```

```yaml
# sparqly.hash.yaml
sources: # may be a string or an array of source specs
  - 'domain.ttl'
  - 'parts/**/*.ttl'
graphMode: flatten # flatten quads to triples for hashing
json: false
# compareWith: "parts/**/*.ttl"   # requires exactly one primary source
```

```yaml
# sparqly.diff.yaml
left: 'domain.ttl' # string or array of source specs
right: # one side may be a glob, the other a single file
  - 'parts/**/*.ttl'
format: human # human | json | rdf-patch
graphMode: preserve # preserve | fillDefault | forceAll | flatten
```

`graphMode: flatten` strips graph names from quad-bearing formats
(`.trig`, `.nq`) and places every statement in the default graph. It works
across `query`, `serve`, `hash`, and `diff` — useful when you want to coerce
quad sources to triples regardless of command.

JSON is supported with the same flat shape (e.g. `sparqly.query.json`); the
extension dispatches the parser.

### Precedence

Values are merged from lowest to highest priority — later sources override
earlier ones:

| Priority    | Source                                |
| ----------- | ------------------------------------- |
| 1 (lowest)  | Built-in defaults                     |
| 2           | Config file (`--config` / `SPARQLY_CONFIG`) |
| 3           | Environment variables                 |
| 4 (highest) | CLI flags (and positional arguments)  |

Environment variables follow a predictable contract:

- Shared keys: `SPARQLY_<UPPER_SNAKE_KEY>` (e.g., `SPARQLY_SOURCES`,
  `SPARQLY_GRAPH_MODE`, `SPARQLY_MUTABLE`).
- Command-specific keys: `SPARQLY_<COMMAND>_<UPPER_SNAKE_KEY>` (e.g.,
  `SPARQLY_SERVE_PORT`, `SPARQLY_QUERY_FORMAT`, `SPARQLY_SERVE_WATCH_DEBOUNCE`,
  `SPARQLY_HASH_JSON`, `SPARQLY_HASH_COMPARE_WITH`).

String env values are coerced to numbers / booleans according to the schema.

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

### Synopsis

```sh
sparqly hash [glob]
            [-s, --sources <glob>]...
            [--graph-mode <preserve|fillDefault|forceAll|flatten>]
            [--json]
            [--compare-with <source>]
            [--config <path>]
            [-v, --verbose] [--quiet]
```

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

### Config block

`sparqly hash` reads the shared config keys (`sources`, `graphMode`,
`verbose`, `quiet`) plus the hash-specific keys below from a top-level `hash:`
block:

```yaml
hash:
  sources: # string | string[] — array → multiple hashes
    - 'domain.ttl'
    - 'parts/**/*.ttl'
  graphMode: flatten # preserve | fillDefault | forceAll | flatten
  json: false # JSON array output instead of <hash>  <source>
  compareWith: 'parts/**/*.ttl' # if set, requires exactly one primary source
```

### Environment variables

```
SPARQLY_SOURCES               # shared
SPARQLY_GRAPH_MODE        # shared — accepts preserve | fillDefault | forceAll | flatten
SPARQLY_VERBOSE               # shared
SPARQLY_QUIET                 # shared
SPARQLY_HASH_JSON             # hash-specific
SPARQLY_HASH_COMPARE_WITH     # hash-specific
```

### Precedence

The same precedence chain applies as for `query` and `serve`: built-in
defaults → config file shared keys → config file `hash:` block → environment
variables → CLI flags.

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

### Synopsis

```sh
sparqly diff [left] [right]
            [--left <source>] [--right <source>]
            [--graph-mode <preserve|fillDefault|forceAll|flatten>]
            [-f, --format <human|json|rdf-patch>]
            [--config <path>]
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

### Graph mode

`diff` honors the shared `graphMode` option just like `query`, `serve`, and
`hash`. The default (`preserve`) keeps graph names as part of statement
identity for quad sources, so `<s,p,o,g1>` and `<s,p,o,g2>` are reported as
one removal + one addition. With `--graph-mode=flatten`, graph names are
stripped before diffing — useful when comparing a quad source against a
triples source.

### Config block

`sparqly diff` reads the shared config keys (`graphMode`, `verbose`,
`quiet`) plus the diff-specific keys below from a top-level `diff:` block:

```yaml
diff:
  left: # string | string[]
    - 'domain.ttl'
  right: 'parts/**/*.ttl'
  format: human # human | json | rdf-patch
  graphMode: preserve # preserve | fillDefault | forceAll | flatten
```

### Environment variables

```
SPARQLY_GRAPH_MODE        # shared
SPARQLY_VERBOSE               # shared
SPARQLY_QUIET                 # shared
SPARQLY_DIFF_LEFT             # diff-specific
SPARQLY_DIFF_RIGHT            # diff-specific
SPARQLY_DIFF_FORMAT           # diff-specific — accepts human | json | rdf-patch
SPARQLY_DIFF_GRAPH_MODE   # diff-specific
```

### Precedence

The same precedence chain applies as for the other commands: built-in defaults
→ config file shared keys → config file `diff:` block → environment variables
→ CLI flags (and the positional `[left] [right]` arguments).

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
