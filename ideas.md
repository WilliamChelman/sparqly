# Ideas

Loose backlog of potential features and improvements, grouped by area.

## Sources

- new source kind: remote file
- merge source (direct materialize only)
- per-source `mutable` (today registry-wide on `serve`; once Yasgui is registry-aware, individual `@id`s may want independent read-only/mutable policies — e.g. one editable scratch source alongside read-only declared globs)
- on the fly http headers (only for endpoints?)
- accept .zip
- options to have eager sources (mostly glob, both memory and disk). Maybe ephemeral too (maybe for in-memory only) so they are always recreated on query.
- "Reject disk-backed globs in hash/diff" should not be so strict, maybe force a filtering query? Or doa pre-query counting number of triples?
- simplify source model: on start, split glob into

## Indexing

- Source status in dedicated page

## Transforms

- merge/split files
- ontology to shacl (dedicated transformation?)
- reasoning as transform
- templated transform options for glob and derived (allow user-defined transforms beyond the closed `graphName` / `annotateSource` registry)

## SHACL & ontology

- ontology / shacl / skos views
- shacl validation
- shacl forms

## Mutation

- mutating queries
- mutable files
- mutation dive
  - file update
  - remote changes (vendor specific?)

## Serve & web UI

- health / stats apis and pages
- logs ui
- api doc page (nestjs swagger)
- search page?
- i18n
- config edit ui + config hot reload
- table view, resizeable columns
- free text source in web for quick anon source (unsecure)
- link from playground to describe use selected source
- query limiting to prevent ddos (both remote and local stores)
- serve
  - trigger data dump (ui and/or ipc)
  - download full query result

## Queries

- quick queries (default select with or without ?g, filled with prefixes from config) + saved queries that make sense
- service queries using source ids
- describe hints
  - uri prefixes / pattern
  - either one source or all (if one source, nice selector). All by default (following hints)

## CLI & output

- terminal table in cli mode
- other output formats
- standalone compile binary (with bun)
- re-evaluate exit codes

## diff & hash

- literal lexical-form normalization — `sparqly hash` (PRD #21) and `sparqly diff` (PRD #30) both use RDFC-1.0, which canonicalizes blank nodes and statement order but does not normalize literals, so `"01"^^xsd:integer` and `"1"^^xsd:integer` hash differently and appear as both an addition and a removal in `diff`. Same for `"1.0"` vs `"1.00"`, language tag casing, etc. Add a normalization pass (numeric/date lexical forms, language-tag case) so semantically-equal literals hash and diff equal.
- diff cmd using templating library instead of "manual" html
- virtual files for diffing sparql endpoints
- reference: https://diffs.com/

## Performance

- file streaming
  - indexing? (htc format or something too)
- incremental rebuild of store in watch mode
- derived cache: add option for process-only
- use storage: disk also for views, maybe streamline caching / mental model in the same go?

## Internals & refactor

- simplify prefix handling: no need to be cute about parsing prefixes bases, except maybe for format
- inverse dependency on source kind: need to implement contract instead of if/elsing/switching everywhere

## Integrations & API

- mcp?
- expose programmatic apis (.js/.ts)

## Testing

- more comprehensive e2e tests with era files

## Misc

- git traversal
