# Glob source transforms and RDF-star source annotations

> **Status:** amended by [ADR-0008](0008-diff-implicit-annotate-source.md) — the transform key was renamed `annotate` → `annotateSource`, and `diff` now auto-injects `annotateSource` on bare glob targets by default. Further amended by [ADR-0032](0032-loader-attached-source-record-sidecar.md) — the side-channel sidecar alternative this ADR rejected is now the canonical diff path; the `annotateSource` transform remains as an explicit-opt-in projection for SPARQL queryability and no longer feeds `diff`.

## Context

Diff over glob sources surfaces "added/removed" canonical N-Quads but no pointer back to the file (and eventually line) the triple was authored in, so users can't jump from a diff hunk to the source. We also want the same source-tracking metadata to be queryable via `sparqly query` / `sparqly serve` so humans and AI agents can SPARQL over "which file said this".

## Decision

Introduce an ordered, closed-registry **transformation pipeline** on glob sources:

```yaml
- id: ontology
  glob: 'data/**/*.ttl'
  transforms:
    - graphName: forceAll
    - annotate:                            # all three IRIs optional; defaults shown
        source: 'urn:sparqly:source'
        file: 'urn:sparqly:file'
        line: 'urn:sparqly:line'
```

Each list item is an object with exactly one transform key — the same presence-of-key discriminator the source-spec already uses for `cache:` (`{ ttl: '1h' }`) and for source kinds (`glob:` / `endpoint:` / `from:` / `empty:`). Closed registry: unknown keys are errors. The same transform key may not appear twice in one source's list. An empty `transforms: []` is valid and a no-op.

Two initial transforms:

- **`graphName`** replaces the existing `graphMode` field (`preserve | fillDefault | forceAll | flatten`) outright. `graphMode` is removed from the schema; configs setting it fail validation. Sparqly is alpha-stage, so the breaking change is acceptable and a migration shim is not provided.
- **`annotate`** emits an RDF-star **Source record** on every asserted triple loaded from disk:

  ```turtle
  <<:s :p :o>> sparqly:source [ sparqly:file <file:///abs/path/a.ttl> ; sparqly:line 5 ] .
  ```

  Each of the three predicate IRIs is **independently configurable** via `annotate.source`, `annotate.file`, `annotate.line`, defaulting respectively to `urn:sparqly:source`, `urn:sparqly:file`, `urn:sparqly:line`. URNs avoid implying a resolvable location for project-internal vocabulary and dodge IANA-registration questions about `https://`-style namespaces sparqly does not own. Per-predicate fields (rather than a single `namespace:` prefix) let users align with their own published vocabulary that may not share a single common prefix. `sparqly:line` is emitted whenever the parser exposes a line number for the triple; line numbers are part of v1, which entails parser plumbing to surface line offsets on each emitted quad.

**Canonicalization** (`hash`, `diff`) operates on **asserted triples only** — RDF-star annotation triples are stripped before RDFC-1.0 normalization, so hashing is independent of annotation presence and reformatting. `diff` rebuilds a `Map<canonicalQuadKey, SourceRecord[]>` per side using the canonicalizer's blank-node label mapping, then attaches source records to each reported difference.

## Considered alternatives

- **Side-channel `WeakMap<Quad, {file,line}>` only.** Cheaper, no Store pollution, no Comunica RDF-star concerns — but kills queryability via `query`/`serve` for humans and agents (the bonus use case).
- **On-demand RDF-star materialization.** Would have kept hash deterministic by construction and avoided always paying the cost — rejected in favor of an always-on declaration on the source spec, so opting in is a property of the source rather than a property of the command. Per-source-spec opt-in is the cost gate.
- **Direct properties on the quoted triple** (`<<:s :p :o>> sparqly:file … ; sparqly:line …`). Cheaper but loses (file,line) pairing when the same triple appears in multiple files within the same graph. The blank-node Source record preserves pairing and extends cleanly to future fields (column, end line, git blob hash).
- **IRI-per-source-location** (`<file:///…#L5>`) under `sparqly:source`. Compact and uses a familiar `#L<n>` idiom but pushes parsing onto every consumer and complicates extension to non-line axes.
- **Including annotations in canonicalization.** Would make `hash` change on file reformatting and swamp `diff` with annotation churn — defeating the very feature annotations are meant to support.
- **Annotate as a deferred/on-demand pipeline entry (mixed eager/deferred classes).** Buys flexibility but introduces a "transformation" concept that isn't a function on the Store; deferred until a second deferred-style transform shows up to justify the design tax.

## Consequences

- **Source-spec schema gains a new public surface.** `transforms: [...]` and the two `kind`s are now part of the config contract; reshaping later breaks user configs.
- **`hash` is unchanged** for any source — annotated or not. This is deliberate and load-bearing for caching.
- **`diff` gains a source-record lookup path.** Plumbing the canonicalizer's blank-node label mapping into the diff layer is non-trivial but bounded.
- **Annotations do not propagate through views.** A `CONSTRUCT`/`SELECT` view query produces fresh triples; the Source records on the upstream's asserted triples are not carried forward unless the view's query explicitly references them. Documented limitation; matches how prefixes already behave.
- **Comunica RDF-star end-to-end support must be verified** before relying on agent-facing SPARQL queries hitting `<<…>>` patterns through `query`/`serve`.
- **Per-format line-number availability is uneven and v1 must handle it.** rdf-parse's quad event does not surface a line number on the public API. To deliver line numbers in v1 we either wrap rdf-parse to intercept the underlying tokenizer or call n3.js's `Parser` directly for the formats it supports (turtle, nq, nt, trig). For formats without meaningful line semantics (json-ld, rdf/xml), `sparqly:line` is omitted from the source record while `sparqly:file` is still emitted.
- **Vocabulary lock-in is mitigated by configurability.** The default URNs are the contract most users will rely on, but `annotate.source` / `annotate.file` / `annotate.line` independently override each predicate so users can align with their own published vocabulary even when those predicates do not share a common prefix.

## Amendment — ADR-0027 (split globs)

A **split glob**'s synthesized **File source** children inherit the parent meta's full **Source transformation pipeline** by value — a deep copy of `transforms:` is attached to each child at expansion time. `graphName: 'forceAll'` and an explicit `annotateSource` declaration on the parent apply identically whether the user targets the meta or one child, so per-file output is consistent with per-meta output. Inheritance is full and eager; per-child transform overrides are out of scope.
