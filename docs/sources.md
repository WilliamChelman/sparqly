# Sources

A **source** is a declared input that produces RDF. Sources are listed under `sources:` in [`sparqly.config.yaml`](./configuration.md) and selected as a command's target via positional `@id`, flag, or the `default: true` marker.

There are three user-declarable kinds. The kind is inferred from which key is present:

| Has key       | Kind     | Meaning                                                                         |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `glob:`       | glob     | RDF files on disk, matched by a glob pattern.                                   |
| `endpoint:`   | endpoint | A remote SPARQL HTTP endpoint.                                                  |
| `empty: true` | empty    | An in-memory store. Hosts an inline query that composes endpoints via `SERVICE`. |

Exactly one of those three keys must be present per entry; declaring more than one (or none) is a parse error.

> **Deriving data from another source.** There is no `view` source kind (removed in [ADR-0051](adr/0051-remove-view-source-kind.md)). Derivation is a *verb*, not a *noun*: scope a source at command time with an inline `--query`/`--query-file` (see [Resolution mode](#resolution-mode)), or bake the result to a file (`sparqly query … -o derived.nq`) and declare a glob source over it. The source fields `from:`, `query:`, `queryFile:`, and `cache:` are no longer accepted and are rejected as unknown keys.

A **source ID** matches `^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$` — alphanumeric, `_`, `-`, `.`; no leading dot, no leading `@`. IDs are required on `empty` sources, optional (but recommended) on `glob` and `endpoint`. Duplicate IDs across the registry are an error.

Within the registry, **at most one** entry may carry `default: true`. That entry is picked as the target when a command is run without an explicit positional or flag.

## String shorthand

Anywhere a source spec is accepted, a bare string is parsed as:

| String form               | Becomes                                  |
| ------------------------- | ---------------------------------------- |
| `https://…` or `http://…` | endpoint with that URL                   |
| `@some-id`                | a reference to `some-id` in the registry |
| anything else             | glob pattern                             |

Two of those forms (glob, `http(s)://`) can work without a config file — `sparqly query "data/**/*.ttl"` and `sparqly query https://example.org/sparql` are both valid one-shot invocations. The `@id` form is a lookup into the registry and only resolves when a config file declares that id under `sources:`.

## glob

```yaml
- id: domain
  glob: 'data/**/*.ttl'
  default: true
  transforms:
    - graphName: flatten
```

| Field               | Required | Notes                                                                          |
| ------------------- | -------- | ------------------------------------------------------------------------------ |
| `glob`              | yes      | Glob pattern. Resolved relative to the **config file's directory**.            |
| `id`                | no       | Recommended so the source is addressable by `@id`.                             |
| `default`           | no       | Must be literally `true` if present. At most one entry per registry.           |
| `transforms`        | no       | Ordered pipeline applied at load time. See [Transforms](#transforms).          |
| `splitByFile`       | no       | Must be literally `true`. See [Split by file](#split-by-file).                  |
| `unionDefaultGraph` | no       | Boolean, defaults to `true`. See [Union default graph](#union-default-graph).  |
| `storage`           | no       | `memory` (default) or `disk`. See [Storage tier](#storage-tier).               |
| `gitRef`            | no       | Pin the matched files to a git ref. See [Git pinning](#git-pinning).           |
| `gitRoot`           | no       | Repo-discovery override; requires `gitRef`. See [Git pinning](#git-pinning).   |

Supported file formats: Turtle, N-Triples, N-Quads, TriG, JSON-LD, RDF/XML.

### Split by file

```yaml
- id: docs
  glob: 'data/**/*.ttl'
  splitByFile: true
```

By default a glob source is the **union** of every matched file under one `@id`. `splitByFile: true` additionally exposes each matched file as its own child source addressable as `@docs/<relative-path>`, alongside `@docs` (the union). Drop it to keep the union only. Glob-only — rejected on endpoint and empty sources.

### Union default graph

When a glob matches quad-bearing files (TriG, N-Quads), the quads land in
**named graphs**. By default (`unionDefaultGraph: true`) SPARQL run against the
glob treats the default graph as the union of the default graph and every named
graph, so a plain `WHERE { ?s ?p ?o }` returns those quads without an explicit
`GRAPH ?g`. Set `unionDefaultGraph: false` for strict SPARQL default-dataset
semantics — only quads in the default graph match a plain pattern. Either way
named graphs stay individually addressable via `GRAPH ?g { ... }`, and the
materialized store is byte-identical: the flag changes query semantics only, not
what is loaded. Split-glob (`splitByFile`) children inherit the parent's value.
The field is rejected on endpoint and empty sources. See
[ADR-0040](adr/0040-union-default-graph-on-glob-sources.md).

### Storage tier

```yaml
- id: big
  glob: 'huge/**/*.ttl'
  storage: disk
```

`storage` selects how `serve` holds the source's quads:

| Value    | Behavior                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` | Default. The store is built in memory (lazily, per ADR-0031) and queried in the worker pool.                                            |
| `disk`   | A persistent on-disk quad index is built (and refreshed when inputs change) under `index.dir`, so the dataset need not fit in RAM.       |

Glob-only. Note that `hash` and `diff` materialize everything into memory, so they reject `storage: disk` sources; use a `memory` source (or an inline query) for those commands. The `index` command and `serve` build the disk indexes — see [`configuration.md`](./configuration.md#index) for `index.dir` / `index.concurrency`. `annotateSource` transforms are rejected on disk-backed globs.

### Git pinning

```yaml
- id: ontology
  glob: 'vocab/**/*.ttl'
  gitRef: v3.2.0
```

`gitRef` pins the matched files to a git ref (full SHA, short SHA, or annotated tag) rather than the working tree. `gitRoot` overrides repo discovery (relative to the config-file directory) and requires `gitRef`. Glob-only; rejected on endpoint and empty sources. Pinning requires the glob to live inside a git repository.

For a one-off pin without editing config, pass `--at <ref>` on `query` / `hash` (it overrides any declared `gitRef:` for that invocation). Only valid for glob targets.

## endpoint

```yaml
- id: fedlex
  endpoint: https://fedlex.data.admin.ch/sparqlendpoint
  auth: { type: bearer, token: ${FEDLEX_TOKEN} }
  headers:
    User-Agent: my-tool/1.0
  timeoutMs: 30000
```

| Field       | Required | Notes                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------- |
| `endpoint`  | yes      | URL of a SPARQL HTTP endpoint.                                             |
| `id`        | no       | Recommended so the source is addressable by `@id`.                        |
| `default`   | no       | Same rules as glob.                                                        |
| `auth`      | no       | One of `{ type: bearer, token }` or `{ type: basic, username, password }`. |
| `headers`   | no       | Extra HTTP headers as `Record<string, string>`.                            |
| `timeoutMs` | no       | Per-request timeout in milliseconds.                                       |

Declaring both `auth` and an explicit `Authorization` header is an error (the two would collide on the wire).

`transforms`, `splitByFile`, `unionDefaultGraph`, `storage`, and `gitRef`/`gitRoot` are rejected on endpoint sources. To scope an endpoint, run an inline query against it (see below).

### Resolution mode

`query` and `serve` against an endpoint target use **pass-through** resolution: the user's query is forwarded to the endpoint over the SPARQL protocol via Comunica federation. `hash` and `diff` always **materialize**, so they reject a raw endpoint target; scope it with an inline query so the materialization is bounded:

```sh
# Hash only a slice of a huge endpoint — the CONSTRUCT runs on the endpoint,
# only the result is materialized and canonicalized locally.
sparqly hash @fedlex \
  --query 'CONSTRUCT { ?act ?p ?o } WHERE { ?act ?p ?o ; <http://schema.org/dateCreated> ?d
                                            FILTER (?d > "2024-01-01"^^<http://www.w3.org/2001/XMLSchema#date>) }'
```

The inline query (`--query` / `--query-file`, and `--left-query`/`--right-query` on `diff`) must produce triples — a `CONSTRUCT { ... }` or a `SELECT` with exactly `{?s, ?p, ?o}` or `{?s, ?p, ?o, ?g}`. The single exception is `diff`, where an arbitrary `SELECT` tuple on both sides switches it into **tabular diff** mode (bag-difference over result rows).

`SERVICE` clauses in a pass-through query are evaluated by the endpoint. If the endpoint can't federate, host the query on an `empty` source instead (see below).

## empty

```yaml
- id: federated
  empty: true
```

```sh
sparqly query @federated --query '
  CONSTRUCT { ?s ?p ?o }
  WHERE {
    SERVICE <https://endpoint-a/sparql> { ?s ?p ?o }
    SERVICE <https://endpoint-b/sparql> { ?s a <http://example.org/Thing> }
  }'
```

An empty source is a no-data placeholder whose only purpose is to host an inline query that reaches its data via `SERVICE` clauses. It exists because pass-through against an endpoint target evaluates `SERVICE` _on that endpoint_, so cross-endpoint federation only works if the endpoint supports `SERVICE` itself. Running the federated query against an empty source forces materialization-with-empty-store, and Comunica dispatches each `SERVICE` from your client.

| Field     | Required | Notes                                                                              |
| --------- | -------- | ---------------------------------------------------------------------------------- |
| `empty`   | yes      | Must be literally `true`.                                                          |
| `id`      | yes      | Required.                                                                          |
| `default` | no       | Permitted but rarely useful — an empty source as a target produces an empty store. |

## Transforms

`transforms:` is a closed registry, valid only on **glob** sources, applied to the loaded store **eagerly** before it's handed to any consumer. Each list item is an object with exactly one transform key (presence-of-key discriminator).

Two transforms are recognized today:

### `graphName`

Rewrites the graph component of each quad. Short and long forms:

```yaml
transforms:
  - graphName: forceAll
```

```yaml
transforms:
  - graphName:
      mode: forceAll
      graph: http://example.org/g
```

| Mode          | Behavior                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `preserve`    | Default. Keep graph names exactly as parsed.                                                                       |
| `fillDefault` | For triples in the default graph, set the graph to `graph` if given, else `file://<path>`. Other graphs untouched. |
| `forceAll`    | Set every quad's graph to `graph` if given, else per-file `file://<path>`.                                         |
| `flatten`     | Drop every graph name; everything ends up in the default graph.                                                    |

The `graph:` override is meaningful only with `fillDefault` and `forceAll`; declaring it with `preserve` or `flatten` is an error.

### `annotateSource`

Emits a **source record** (an RDF-star annotation) on each asserted triple, recording the file (and 1-based line, when the parser supplies it) the triple was loaded from. Used by `diff` to surface provenance inline in its output.

```yaml
transforms:
  - annotateSource:
      source: urn:my-app:source
      file: urn:my-app:file
      line: urn:my-app:line
```

The three predicate IRIs are independently configurable; defaults are `urn:sparqly:source`, `urn:sparqly:file`, and `urn:sparqly:line`. Pass `annotateSource:` with no body (or `null`) to opt into the defaults.

`diff` auto-injects `annotateSource` at the head of every glob target's pipeline in **graph-diff** mode, so the predicates can be picked up by the diff renderer. An explicit declaration in config takes precedence (no double-apply); the explicit predicates are preserved. Suppress the implicit injection with `--skip-auto-source-annotation`. See [ADR-0008](./adr/0008-diff-implicit-annotate-source.md) for the full rules.

`hash` strips source records before canonicalization, so they never affect the hash.

## Default and target selection

A command runs against exactly one **target source**, chosen by precedence:

1. Explicit positional or flag (an `@id` ref or an inline glob/URL).
2. The registry entry marked `default: true`.
3. The sole entry, when the registry has exactly one source.

Otherwise the command errors and lists the available `@id`s. A `kind: 'reference'` alias is rejected as a target — references are pointers, not data.

Multi-source merging at the command boundary is intentionally not provided. Compose across sources with an inline query, optionally hosted on an `empty` source for federated `SERVICE` queries.

Merging many files **inside a single source** (a glob) into one output file is a `query` recipe — see [docs/recipes.md](./recipes.md#merge-files-into-one-output).
