# Union default graph on glob sources

## Context

A glob source that loads TriG / N-Quads files keeps each quad's named graph. SPARQL's default dataset semantics then make that data invisible to plain triple patterns: `SELECT * WHERE { ?s ?p ?o }` matches only the default graph, so named-graph quads can only be reached through an explicit `GRAPH ?g { ... }`. sparqly invokes Comunica with a bare `{ sources: [store] }` context (`engine/query-engine.ts`, `views/view-resolver.ts`), so this is the behaviour today.

This surprises users who think of a glob as "my data" and expect to query all of it flatly. It is also a footgun in combination with the `graphName` transform: `forceAll` / `fillDefault` move quads into named graphs, after which a plain `WHERE { ?s ?p ?o }` returns *nothing*.

The `graphName: flatten` mode already makes everything queryable flatly, but destructively — it erases graph names, so `GRAPH ?g` no longer works and `hash`/`diff` canonicalize as one flat graph. We want flat access **without** giving up the named-graph partitioning.

## Decision

Introduce a boolean field **`unionDefaultGraph`** on glob sources, **defaulting to `true`**. It is implemented as Comunica's `unionDefaultGraph` query-context option, set on every SPARQL execution against the glob's materialized Store. When on, the default graph behaves as the union of the default graph and every named graph; named graphs remain independently addressable via `GRAPH ?g`.

```yaml
- id: ontology
  glob: 'data/**/*.trig'
  unionDefaultGraph: false   # opt out; default is true
```

- **Query-context option, not a `graphName` transform mode.** The option leaves the Store byte-identical. A transform-style implementation would have to copy every named-graph quad into the default graph, double-counting triples under RDFC-1.0 canonicalization and corrupting `hash` / `diff`.
- **Scope.** Valid only on glob sources. A **split glob**'s synthesized **File source** children inherit it. Declaring it on endpoint, view, or empty sources is a parse error — a pass-through endpoint owns its own dataset semantics, and views/empty sources do not import quads.
- **Application points.** Honored wherever sparqly runs SPARQL against the glob's materialized Store: direct `query` / `serve`, and a **view**'s own query when its `from:` chain resolves down to that glob. It is never propagated to a view's *output* Store — querying a view is querying a computed dataset, which runs with standard SPARQL semantics.

## Considered alternatives

- **A store-mutating `graphName` mode (e.g. `graphName: union`).** Rejected: every `graphName` mode rewrites quads, so a union mode would copy named-graph quads into the default graph, double-counting them in `hash` canonicalization and producing phantom default-graph quads in `diff`.
- **Defaulting `unionDefaultGraph` to `false` (pure opt-in).** Spec-faithful and a zero-behaviour-change rollout, but leaves the `forceAll` / `fillDefault` footgun in place and keeps named-graph data silently invisible for the user who never thinks about graphs. Rejected: the intuitive behaviour should be the one you get without configuring anything.
- **A global config block or CLI flag instead of a per-source field.** A global setting cannot be honored by endpoint sources and is too blunt; a CLI flag is ephemeral and does not let the source spec declare its own nature. A per-source field is declarative and matches how `transforms` already attaches to glob sources. A CLI flag / webapp toggle override remains a clean future addition.

## Consequences

- **Breaking change, narrowly scoped.** Turtle / N-Triples sources are unaffected — union-of-{default graph} is still the default graph. Only sources whose loaded Store has at least one named graph change behaviour, and only for SPARQL execution (`query`, `serve`, view queries). `hash` / `diff` of a raw glob canonicalize the Store directly without running SPARQL, so they are untouched.
- **Divergence from SPARQL default-dataset semantics is deliberate.** A user who parks data in a named graph specifically to scope it out of everyday queries (e.g. retraction markers) must set `unionDefaultGraph: false` on that source to restore the isolation.
- **Fixes the `graphName: forceAll` / `fillDefault` footgun.** Quads moved into named graphs by those modes stay queryable by default.
- **Source-spec schema gains a new public surface.** `unionDefaultGraph` is now part of the config contract.
