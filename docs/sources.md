# Sources

A **source** is a declared input that produces RDF. Sources are listed under `sources:` in [`sparqly.config.yaml`](./configuration.md) and selected as a command's target via positional `@id`, flag, or the `default: true` marker.

There are four user-declarable kinds. The kind is inferred from which key is present:

| Has key       | Kind     | Meaning                                                                        |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `glob:`       | glob     | RDF files on disk, matched by a glob pattern.                                  |
| `endpoint:`   | endpoint | A remote SPARQL HTTP endpoint.                                                 |
| `from:`       | view     | A SPARQL `CONSTRUCT` or `SELECT` that scopes another source (the "upstream").  |
| `empty: true` | empty    | An in-memory store. Hosts a view whose query composes endpoints via `SERVICE`. |

Exactly one of those four keys must be present per entry; declaring more than one (or none) is a parse error.

A **source ID** matches `^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$` — alphanumeric, `_`, `-`, `.`; no leading dot, no leading `@`. IDs are required on `view` and `empty` sources, optional (but recommended) on `glob` and `endpoint`. Duplicate IDs across the registry are an error.

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

| Field        | Required | Notes                                                                 |
| ------------ | -------- | --------------------------------------------------------------------- |
| `glob`       | yes      | Glob pattern. Resolved relative to the **config file's directory**.   |
| `id`         | no       | Required if you want to reference it from a view's `from:`.           |
| `default`    | no       | Must be literally `true` if present. At most one entry per registry.  |
| `transforms` | no       | Ordered pipeline applied at load time. See [Transforms](#transforms). |

Supported file formats: Turtle, N-Triples, N-Quads, TriG, JSON-LD, RDF/XML.

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
| `id`        | no       | Required to reference from a view's `from:`.                               |
| `default`   | no       | Same rules as glob.                                                        |
| `auth`      | no       | One of `{ type: bearer, token }` or `{ type: basic, username, password }`. |
| `headers`   | no       | Extra HTTP headers as `Record<string, string>`.                            |
| `timeoutMs` | no       | Per-request timeout in milliseconds.                                       |

Declaring both `auth` and an explicit `Authorization` header is an error (the two would collide on the wire).

`transforms` and `cache` are rejected on endpoint sources. Apply scoping or per-source caching via a **view** with the endpoint as its upstream.

### Resolution mode

`query` and `serve` against an endpoint target use **pass-through** resolution: the user's query is forwarded to the endpoint over the SPARQL protocol via Comunica federation. `hash` and `diff` always **materialize**, so they reject endpoint sources unless the materialization is bounded by a view (or anonymous view via `--query` / `--query-file`).

## view

```yaml
- id: recent-acts
  from: '@fedlex'
  query: |
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    CONSTRUCT { ?act ?p ?o }
    WHERE    { ?act ?p ?o ; <http://schema.org/dateCreated> ?d
               FILTER (?d > "2024-01-01"^^xsd:date) }
  cache:
    ttl: 1h
```

| Field       | Required | Notes                                                                                |
| ----------- | -------- | ------------------------------------------------------------------------------------ |
| `id`        | yes      | View IDs are mandatory.                                                              |
| `from`      | yes      | A single `@id` ref string. Multi-source composition uses `SERVICE` inside the query. |
| `query`     | one of   | Inline SPARQL string. Mutually exclusive with `queryFile`.                           |
| `queryFile` | one of   | Path to a `.rq` file. Resolved relative to the config file's directory.              |
| `cache`     | no       | Result-cache strategy. See [View caching](#view-caching).                            |
| `default`   | no       | Same rules as glob.                                                                  |

### Accepted query shapes

The view's query must produce triples — either a `CONSTRUCT { ... }` or a `SELECT` with exactly the variables `{?s, ?p, ?o}` or `{?s, ?p, ?o, ?g}`. This is what lets a view be substituted for any other RDF-producing source.

The single exception: an **anonymous view** synthesized by `diff` from `--left-query` / `--right-query` may project an arbitrary `SELECT` tuple, which switches `diff` into **tabular diff** mode (bag-difference over result rows). Declared views remain triple-only.

### Resolution mode

A view's resolution mirrors its upstream:

- Upstream is `glob` / `empty` / another view → **materialized**: load the upstream into an in-memory store, then run the view's query against that store.
- Upstream is `endpoint` → **pass-through**: forward the view's query to the endpoint, which executes it.

`SERVICE` clauses inside a pass-through view are evaluated by the upstream endpoint. If the endpoint can't federate, host the query on an `empty` source instead (see below).

### View caching

`cache:` declares exactly one strategy:

| Strategy            | Field                 | Behavior                                                                                                                          |
| ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| TTL                 | `ttl: 1h` (or ms int) | Result is reused until the TTL expires. Duration units: `ms`, `s`, `m`, `h`, `d`.                                                 |
| Freshness probe     | `freshness: <ASK>`    | On lookup, run the ASK against the upstream; reuse if it returns `true`. For an endpoint upstream the ASK is itself pass-through. |
| Everlasting         | `everlasting: true`   | Cached result never invalidates. Manage manually with `sparqly cache clear`.                                                      |
| (per-view override) | `cacheDir: <path>`    | Override the project's `cache.dir` for this view only.                                                                            |

Cache keys compose `view.id + from + query + upstream-spec`, so a structural change to any of those invalidates the entry.

`cache` is rejected on non-view sources.

## empty

```yaml
- id: federated
  empty: true
```

```yaml
- id: cross-endpoint
  from: '@federated'
  query: |
    CONSTRUCT { ?s ?p ?o }
    WHERE {
      SERVICE <https://endpoint-a/sparql> { ?s ?p ?o }
      SERVICE <https://endpoint-b/sparql> { ?s a <http://example.org/Thing> }
    }
```

An empty source is a no-data placeholder whose only purpose is to host a view that reaches its data via `SERVICE` clauses. It exists because pass-through against an endpoint upstream evaluates `SERVICE` _on the upstream_, so cross-endpoint federation only works if that endpoint supports `SERVICE` itself. Wrapping the federated query in an empty-hosted view forces materialization-with-empty-store, and Comunica dispatches each `SERVICE` from your client.

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

Otherwise the command errors and lists the available `@id`s. A `kind: 'reference'` alias is rejected as a target — references are upstream pointers, not data.

Multi-source merging at the command boundary is intentionally not provided. Compose across sources with a view, optionally hosted on an `empty` source for federated `SERVICE` queries.
