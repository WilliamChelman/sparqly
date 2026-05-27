# Ideas

Loose backlog of potential features and improvements, grouped by area.

## Sources

- new source kind: remote file
- merge source (direct materialize only)
- on the fly http headers (only for endpoints?)
- credentialed remote endpoints — store bearer/basic auth in the OS keychain rather than plain config
- accept .zip
- options to have eager sources (mostly glob, both memory and disk). Maybe ephemeral too (maybe for in-memory only) so they are always recreated on query.
- "what's in this source?" overview — class/predicate frequency tables, top namespaces, sample instances per class

## Transforms

- merge/split files
- ontology to shacl (dedicated transformation?)
- reasoning as transform
  - OWL RL / RDFS materialization toggle (per source, or scoped to a query)
  - rule-based inference via SHACL rules (`sh:rule`, both `sh:SPARQLRule` and `sh:TripleRule`); iterate to fixpoint with a cap, tag inferred triples with their rule for provenance / diffing
- templated transform options for glob and derived (allow user-defined transforms beyond the closed `graphName` / `annotateSource` registry)

## SHACL & ontology

- ontology / shacl / skos views
- shacl validation
- shacl forms

## Mutation

- mutating queries
- mutable files (propagate changes to source files)
- mutation dive
  - file update
  - endpoint mutations (vendor specific?)

## Serve & web UI

- logs ui
- api doc page (nestjs swagger)
- search page?
- i18n
- config edit ui + config hot reload
- table view, resizeable columns
- free text source in web for quick anon source (unsecure)
- link from playground to describe use selected source
- query limiting to prevent ddos (both remote and local stores)
  - per-query rate limits, global concurrency caps, per-source caps
- serve
  - trigger data dump (ui and/or ipc)
  - download full query result
  - healthcheck / readiness endpoints (`/healthz`, `/readyz`) reflecting index state per source
  - Prometheus `/metrics` endpoint + OpenTelemetry traces (OTLP) — opt-in; metrics by source/kind/result, spans per query with source attributes; bucket query text via hash to avoid high cardinality
- VoID + SPARQL 1.1 service description generation — auto-published per source and for the registry (triple/class/predicate partitions, namespaces, supported features); also exposed as a `sparqly describe` CLI command
- result views beyond the table
  - graph / node-link view for CONSTRUCT/DESCRIBE (or any `?s ?p ?o`-shaped SELECT); click a node to expand via `DESCRIBE`, color by `rdf:type`, cap node count
  - pivot / chart view over SELECT results (group-by + aggregate, bar/line/scatter)
  - geo view for WKT / GeoSPARQL columns on a map
- notebook-style documents — markdown with fenced ` ```sparql {source=…, name=…} ` cells, shared prefixes / parameters in front-matter, runnable from CLI (`sparqly notebook run`) and rendered in the web UI; cells pick their renderer (table/graph/chart/map)
- keyboard-driven UX — command palette (Cmd+K) for navigation, query/source switching, action invocation
- run in-memory queries in sub-processes? (hanging http queries again)
  - bring back virtual scroll (or local pagination) + add local text search

## Queries

- quick queries (default select with or without ?g, filled with prefixes from config) + saved queries that make sense
- service queries using source ids
- describe hints
  - uri prefixes / pattern
  - either one source or all (if one source, nice selector). All by default (following hints)
- query history — per-workspace, searchable, with timing and source bound; re-run / pin to saved queries
- auto-format / lint SPARQL in the editor, with prefix folding (collapse the PREFIX block, keep IRIs prefixed everywhere)
- data-driven predicate autocomplete — suggest properties / paths based on what the indexed source actually contains, not just declared ontology
- LOV-style prefix lookup — when an unknown prefix is typed, suggest the canonical IRI from prefix.cc / LOV and offer to add it to config

## CLI & output

- terminal table in cli mode
- other output formats
- standalone compile binary (with bun) — single-binary distribution per platform, no node runtime required
- re-evaluate exit codes

## diff & hash

- literal lexical-form normalization — `sparqly hash` (PRD #21) and `sparqly diff` (PRD #30) both use RDFC-1.0, which canonicalizes blank nodes and statement order but does not normalize literals, so `"01"^^xsd:integer` and `"1"^^xsd:integer` hash differently and appear as both an addition and a removal in `diff`. Same for `"1.0"` vs `"1.00"`, language tag casing, etc. Add a normalization pass (numeric/date lexical forms, language-tag case) so semantically-equal literals hash and diff equal.
- diff cmd using templating library instead of "manual" html
- virtual files for diffing sparql endpoints
- reference: https://diffs.com/

## Performance

- query timings
- incremental rebuild of store in watch mode
- derived cache: add option for process-only
- use storage: disk also for views, maybe streamline caching / mental model in the same go?
- remove "all" from describe page

## Internals & refactor

- simplify prefix handling: no need to be cute about parsing prefixes bases, except maybe for format
- inverse dependency on source kind: need to implement contract instead of if/elsing/switching everywhere
- simplify model of view and storage: disk? (caching etc.)

## Integrations & API

- mcp?
- expose programmatic apis (.js/.ts)

## Testing

- more comprehensive e2e tests with era files

## Misc

- feature flags
- git traversal
