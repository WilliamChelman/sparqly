---
status: accepted
---

# View `from:` is a single ref; multi-source composition uses SPARQL `SERVICE`

A view's `from:` is narrowed from `ReadonlyArray<string>` to a single `string` ref, eliminating in-resolver multi-upstream merging. Cross-source composition is delegated to SPARQL `SERVICE` clauses authored in the view query. To support composing across endpoints whose own SPARQL implementation cannot federate via `SERVICE`, a new `kind: 'empty'` source is introduced — an in-memory `Store` with no triples that exists solely to host a query whose data flows in through `SERVICE` clauses dispatched by Comunica's local engine.

## Considered Options

- **Keep multi-`from:` merging.** Rejected — it forces materialize-then-query semantics whenever a view declares more than one upstream, re-creating (in different shape) the OOM trap ADR-0003 was written to avoid. It also competes with `SERVICE` as a composition mechanism without offering anything `SERVICE` cannot, except the ability to merge local globs — see next bullet.
- **Keep multi-glob `from:` only (allow merging across local files but not endpoints).** Rejected — codifies a special case that exists purely because `SERVICE` cannot reach a glob. Users who need to merge file sets can collapse to a broader glob pattern or pre-process; "compose multiple file sets into one queryable view" is what a triple store is for, not a CLI source-spec.
- **Optional opt-out of pass-through (`passThrough: false`) so non-SERVICE-supporting endpoints can be composed via materialize.** Rejected — same flag we rejected in ADR-0003 for the same reason: the materialize-an-endpoint path is a correctness/scalability trap with no legitimate use case at endpoint scale.
- **Make `from:` optional on a view to mean "execute against an empty store."** Rejected — re-loosens the "view requires a single ref" rule we just locked in, and the resolver would have to special-case "no upstream." Modeling it as a first-class `empty` source keeps `from: '@ref'` strict and the union of source kinds is where the new vocabulary lives.
- **Lenient input parsing (accept `from: ['@x']` and unwrap to `from: '@x'`).** Rejected — sparqly is pre-1.0; a hard error with a migration message pointing at `SERVICE` is clearer than silently accepting the array form, and silent unwrap of `from: ['@a', '@b']` would be data loss.
- **String shorthand for empty (`'@empty'` or similar).** Rejected — no natural shorthand, and a magic ref string would collide with user-chosen ids. Object-form-with-flag (`{ id: '...', empty: true }`) matches how `glob:`, `endpoint:`, and `from:` already discriminate kinds.

## Consequences

- **`ParsedViewSource.from` becomes `string`** (single ref). Every consumer downstream (`view-resolver`, `view-cache`, `anonymous-view-builder`, server) reads a single ref instead of iterating an array.
- **`parseSourceSpec` rejects `from: [...]`** with an error that names the new model and points at `SERVICE`-clause composition. The `validateSourceGraph` check that endpoint refs must be alone in `from:` is removed (subsumed by the single-ref invariant).
- **New `ParsedEmptySource`** in the source-spec union: `{ kind: 'empty'; id: string }`. Object input `{ id, empty: true }` parses to it; mixing `empty: true` with `glob:`, `endpoint:`, or `from:` is an error.
- **`view-resolver` materialized path handles `empty`**: produces an empty `Store` and runs the view query against it via Comunica, which dispatches any `SERVICE` clauses. Pass-through is unchanged.
- **`view-cache` keys** lose the multi-upstream array hashing on the `from:` axis; the upstream contribution becomes a single entry. Existing on-disk caches whose view had `from: [@x]` (single-element array) will see a key change and miss once — acceptable given alpha status.
- **Anonymous views** keep their existing single-upstream shape; the builder simplifies because it no longer wraps the upstream id in an array.
- **`SERVICE`-on-pass-through caveat**: when a view's upstream is an endpoint, the entire query (including any `SERVICE` clauses) is forwarded to that endpoint over the SPARQL protocol. Cross-endpoint composition therefore depends on the upstream's own `SERVICE` support; users with non-SERVICE-capable upstreams should host their composition on an `empty` source instead. Documented in `CONTEXT.md`.
- **Breaking change**: configs that ship `from: [...]` (any length) or that relied on multi-upstream merge stop parsing. No deprecation window — sparqly is in alpha.
- **Glossary**: `CONTEXT.md` adds **Empty source** and rewrites **View** / **Upstream** for the single-ref model.

## Amendment — ADR-0027 (split globs)

The set of acceptable upstream kinds for a view's single `from:` ref widens from `glob | endpoint | empty | view` to `glob | file | endpoint | empty | view`. A **File source** synthesized as the child of a **split glob** is a valid `from:` ref (e.g. `from: '@docs/foo.ttl'`); resolution is **materialized**, identical to a one-file glob. The "single `@id`" rule is unchanged — a view still references exactly one upstream.
