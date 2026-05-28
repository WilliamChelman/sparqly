# Recipes

Short, copy-pasteable patterns for common tasks that are achievable with the existing commands but non-obvious from the reference docs alone.

## Merge files into one output

A frequent need: combine many RDF files into a single file. `query` covers this — there is no dedicated `merge` command (see [ADR-0049](adr/0049-query-rdf-output-formats-and-triple-shaped-select-reification.md)). The shape of the recipe depends on whether the inputs carry named graphs you want to preserve.

### Triple merge — Turtle in, Turtle out

Flatten any number of Turtle (or other triple-only) files into one `.ttl`:

```sh
sparqly query "data/**/*.ttl" \
  -q 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' \
  --out merged.ttl
```

`--out merged.ttl` infers `--format turtle`. The output is one Turtle document containing the union of every matched file's triples. Blank nodes are scoped to the output document; named graphs in the inputs are flattened away.

### Quad-preserving merge — TriG/N-Quads in, N-Quads out

Combine TriG or N-Quads sources into one `.nq`, keeping every triple in its original named graph:

```sh
sparqly query "data/**/*.trig" \
  -q 'SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }' \
  --out merged.nq
```

`--out merged.nq` infers `--format nquads`. The triple-shaped `SELECT ?s ?p ?o ?g` is reified back into quads on the way out. Rows where `?g` is unbound — for instance triples that lived in the default graph of an input file — are promoted to the default graph of the output rather than dropped.

Swap `--out merged.nq` for `--out merged.trig` to get the same data in TriG instead.

### Why no `sparqly merge`?

A dedicated `merge` command was considered and rejected: `query` with a `CONSTRUCT` or a triple-shaped `SELECT ?s ?p ?o ?g` already covers both the triple and quad cases, and a separate command would duplicate `query`'s output-format and extension-inference logic. See the Considered alternatives section of [ADR-0049](adr/0049-query-rdf-output-formats-and-triple-shaped-select-reification.md).
