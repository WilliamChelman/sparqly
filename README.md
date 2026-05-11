<img src="assets/icon.svg" alt="sparqly" width="96" />

# Sparqly

A CLI for querying, hashing, diffing, formatting, and serving RDF.
Canonical-form `hash` and `diff` (RDFC-1.0, blank-node-stable), plus an embedded YASGUI playground.

> Alpha — pre-1.0; expect breaking changes between releases. See [CHANGELOG](./CHANGELOG.md) before upgrading.

## Install

Requires Node **22+**.

```sh
npm install -g sparqly
sparqly --help

# or, no install
npx sparqly --help
```

## Quickstart

Run SPARQL against a glob of RDF files:

```sh
sparqly query "data/**/*.ttl" -q 'SELECT * WHERE { ?s ?p ?o } LIMIT 10'
```

Open the embedded playground in your browser:

```sh
sparqly serve "data/**/*.ttl" --port=3000
# UI at http://localhost:3000, SPARQL endpoint at /api/sparql
```

`serve` exposes every non-`reference` source at `/api/sparql/<id>` (plus `/api/diff`, `/api/describe`, `/api/source-snippet`, `/api/config`, and the playground). Pass a positional glob/URL or `--source @id` to scope the served set to one entry. It's a single-user development tool — not hardened for concurrent users.

Detect drift between a curated source and its split parts. `hash --compare-with` exits 1 on mismatch; `diff` then shows exactly which triples drifted:

```sh
sparqly hash domain.ttl --compare-with "parts/**/*.ttl"
# match: 4f3c…a1

# On mismatch:
sparqly diff domain.ttl "parts/**/*.ttl"
# - <http://example.org/c> <http://example.org/q> <http://example.org/d> .
# + <http://example.org/c> <http://example.org/q> <http://example.org/d2> .
```

## Sources

A **source** is a declared input that produces RDF. Sparqly understands four kinds:

- **glob** — files on disk (the quickstart examples above).
- **endpoint** — a remote SPARQL HTTP endpoint.
- **view** — a SPARQL `CONSTRUCT` or `SELECT` that scopes another source.
- **empty** — an in-memory store, used to host a federated query that composes endpoints via `SERVICE` clauses (handy when the upstream endpoint can't federate itself).

Sources are declared in `sparqly.config.yaml` and referenced by `@id` on the CLI. The kind is inferred from which key is present (`glob:`, `endpoint:`, `from:` + `query:`, or `empty: true`):

```yaml
# sparqly.config.yaml
sources:
  - id: fedlex
    endpoint: https://fedlex.data.admin.ch/sparqlendpoint
  - id: recent-acts
    from: '@fedlex'
    query: |
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
      CONSTRUCT { ?act ?p ?o }
      WHERE    { ?act ?p ?o ; <http://schema.org/dateCreated> ?d
                 FILTER (?d > "2024-01-01"^^xsd:date) }
```

```sh
sparqly query @recent-acts -q 'SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }'
```

See [docs/sources.md](docs/sources.md) for the full source-spec reference — auth on endpoints, source transforms (`graphName`, `annotateSource`), view caching strategies, and the `empty` + `SERVICE` federation pattern.

## Next steps

- All commands and flags — `sparqly --help`
- Project config (`sparqly.config.yaml`) — [docs/configuration.md](docs/configuration.md)
- Building from source / contributing — [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT
