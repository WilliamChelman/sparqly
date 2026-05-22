---
status: accepted
amends: 0006, 0027, 0031, 0032
---

# Disk-backed glob materialization via embedded quadstore

## Context

A **Glob source** resolves by **Materialized resolution**: every matched file is parsed into an in-memory `n3.Store`, and `serve` memoizes that Store for the life of the process (ADR-0031). This works until the matched triples no longer fit in the V8 heap, at which point `serve` does not degrade — it crashes:

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

The triggering case is concrete: a glob over `~6.4 GB` of N-Quads across six files (one is `2.8 GB` on its own), roughly `30–40 M` quads. There is no realistic heap that holds this in `n3.Store`: ~30 M quads is ~5–9 GB across the store's three nested indexes, and the **Source record sidecar** — which ADR-0032 made *unconditional* on the rationale that it is "cheap O(quads) bookkeeping" — adds a second in-heap copy (one `SourceRecord` plus one N-Triples string key per quad), another ~6–9 GB. The "cheap" rationale holds at small scale and is exactly the failure mode at large scale.

No quad cap, file-count cap, or heap budget exists anywhere (ADR-0026's "file-size budget" governs *source-code* files, not data). `CONTEXT.md` defines **Materialized resolution** as loading the upstream "into a local *in-memory* `Store`" — the in-memory assumption is baked into the domain language.

The data that provokes this is a static monthly snapshot. The goal: make `serve` (and `query`) work on a glob whose triples exceed RAM, without standing up external infrastructure.

## Decision

**Add a disk-backed storage tier for glob materialization, selected per-source, backed by an embedded persistent quad store.**

- **`storage` field.** Glob sources gain `storage: memory | disk`, default `memory`. `disk` makes the glob a **Disk-backed glob**. Valid only on glob/file sources — a parse error on endpoint, view, and empty sources — and inherited by a **split glob**'s **File source** children (each child indexed independently). This mirrors the per-source, declarative shape of `unionDefaultGraph` (ADR-0040) and `transforms` (ADR-0006).

- **Backend: embedded quadstore.** A `disk` glob materializes into a **Glob index** — an embedded LevelDB-backed quad store (`quadstore` + `classic-level`) under `<configDir>/.sparqly/index/<source-id>/`; the cache path is config-overridable. quadstore is in-process, a pure npm dependency with no external binary or toolchain, genuinely persistent, and exposes the RDF/JS `Store` interface.

- **Query path: existing engine, plain RDF/JS source.** The quadstore instance is passed into the *current* Comunica engine via the existing `sources: [...]` context — no second engine. A disk-backed glob answers SPARQL **identically** to an in-memory one; only the memory ceiling differs. `unionDefaultGraph` remains a query-context option and is unaffected.

- **Build: background, on first touch.** Building a multi-GB index is a ~10–15-min operation. `serve` does not block on it: the first request that touches a disk-backed glob whose index is absent or stale kicks a background build. `EngineMap`'s memoized `loaded` slot (ADR-0031) becomes a small state machine — `indexing` (requests answered `503`) → `ready`, or `failed` (slot cleared so a later request retries). An already-fresh index opens straight to `ready` with no `503`.

- **Staleness: detect, warn, never auto-rebuild.** The index dir carries a manifest — matched file paths, sizes, mtimes; the sparqly version; the applied transform pipeline. A mismatch on open is a `warn`-level boundary log, not a silent rebuild (rebuilds are too heavy to trigger implicitly). `serve --watch` does not hot-rebuild a disk-backed glob.

- **Discoverability warning.** When a glob is *not* flagged `storage: disk` but its matched bytes exceed a soft hint, `serve` emits one `warn`-level boundary log pointing at `storage: disk` — the same posture ADR-0028 took for empty-glob matches.

- **No sidecar.** A disk-backed glob produces no **Source record sidecar** — an in-heap map of one record per quad is precisely the cost this change exists to escape. This **amends ADR-0032**: its unconditional sidecar is scoped to in-memory globs.

- **Transforms baked at build time.** A disk-backed glob's `graphName` transform is applied during ingest and baked into the index; the manifest records the pipeline — each transform's key *and* config — so a transform change, including a re-pointed `graphName` mode or graph override, registers as staleness. `annotateSource` is **rejected as a parse error** on a disk-backed glob — see the *Verification outcome* section below.

- **Scope.** `query` and `serve` honor `storage: disk`. `hash` and `diff` **reject** a disk-backed glob with a clear error — both depend on RDFC-1.0 **Canonicalization**, which needs every quad in memory to compute the blank-node labeling and would OOM regardless of where the quads are stored.

## Considered alternatives

- **(A) Push the data into an external SPARQL endpoint** (Fuseki / GraphDB / Oxigraph server) and declare a `kind: 'endpoint'` source. Zero new code — `serve` already pass-throughs endpoints. Rejected as the answer: it abandons the reason a `glob` source exists — declarative, self-contained, no infrastructure to run — and the data stops being a glob with split-glob / transform affordances.

- **(C) Stay in-memory: drop the sidecar, raise `--max-old-space-size`.** Rejected: 6.4 GB of N-Quads will not hold robustly at any heap size; this only postpones the crash.

- **Embedded Oxigraph (`oxigraph` npm).** The original front-runner. Rejected on verification: the `oxigraph` npm package is compiled to WebAssembly and is **in-memory only** — RocksDB persistence is disabled in the WASM build. An embedded *disk-backed* Oxigraph library for Node does not exist today.

- **Oxigraph CLI as a sparqly-managed subprocess.** The `oxigraph` binary does persist to RocksDB and is excellent at this scale. Rejected: it reintroduces the separate-process and per-platform-binary burden that motivated rejecting (A), for a workload quadstore handles in-process.

- **HDT** (`hdt` npm, read via Comunica's HDT actor). Extremely compact and low-RAM, well-suited to a static snapshot. Rejected: read-only, the `hdt` npm carries 2014-era native bindings prone to modern-Node build breakage, and `nq → hdt` conversion needs a separate C++ (or young Rust) converter — the toolchain friction (A) and the Oxigraph-subprocess option were both rejected for.

- **`quadstore-comunica` distribution** instead of the plain RDF/JS source. Better join planning via quadstore's index statistics, but a *second* query engine — two dependency trees and a risk that an in-memory glob and a disk-backed glob answer the same query differently. Rejected: result-consistency across the storage tier outweighs a join-planning optimization, and query performance is a separate concern from the materialization OOM this ADR fixes.

- **Automatic, threshold-triggered disk-backing.** sparqly measures matched bytes and silently switches above a limit. Rejected: the threshold is a magic number, and a silent ~15-min index build on `serve` boot is the kind of surprising side effect the project consistently avoids. The explicit field plus a discoverability warning gives the same "user finds the fix" outcome without the surprise.

- **Synchronous or `sparqly index`-command build.** A synchronous build blocks boot or hangs the first request for ~15 min. A dedicated pre-build command is predictable and CI-scriptable but forces a second command before `serve` works. Rejected in favor of the background build, which keeps `serve` responsive and self-sufficient; a `sparqly index` pre-build command remains a clean future addition.

- **Persist the sidecar to disk** alongside the index so `diff` keeps source snippets. Rejected: roughly doubles the index to feed a `diff` that cannot run anyway — `diff` of a disk-backed glob is rejected because canonicalization cannot scale to 30 M quads.

## Consequences

- **New public config surface.** `storage` joins `unionDefaultGraph`, `splitByFile`, and `transforms` as part of the glob source contract.

- **New runtime dependency.** `quadstore` + `classic-level` (a native LevelDB binding) enter the dependency tree. `classic-level` ships prebuilt binaries for common platforms.

- **On-disk footprint.** The **Glob index** is larger than the source data — quadstore maintains six index permutations; expect the index dir to exceed the matched bytes (LevelDB compression offsets this only partially). The cache dir is gitignore-able.

- **`hash` / `diff` reject disk-backed globs.** A deliberate, named capability gap: provenance-rich diffing does not scale to this dataset size, and failing loudly beats OOM-ing.

- **`serve` degrades gracefully under scale.** A disk-backed source returns `503 indexing` during its first-ever build instead of crashing the process; every other source stays available throughout.

- **ADR-0006** — amended: a disk-backed glob's transform pipeline is applied at index-build time and baked into the **Glob index**, rather than applied to an in-memory Store on every load.

- **ADR-0027** — amended: a **split glob**'s File-source children inherit `storage` alongside `transforms` and `unionDefaultGraph`; each child materializes its own independent **Glob index**.

- **ADR-0031** — amended: `EngineMap`'s memoized `loaded` slot becomes an `indexing` / `ready` / `failed` state machine for disk-backed sources. The lazy-materialization *timing* contract is otherwise unchanged.

- **ADR-0032** — amended: the unconditional **Source record sidecar** is scoped to in-memory globs. The decision's "cheap O(quads) bookkeeping" rationale held for the in-memory tier and is explicitly falsified for the disk-backed tier.

- **`CONTEXT.md` vocabulary shift.** **Materialized resolution** redefined around two storage tiers; **Disk-backed glob** and **Glob index** added; **Glob source**, **Lazy materialization**, and **Source record sidecar** amended.

- **Open verification items for implementation** (do not change this decision): confirm quadstore stores RDF-star quoted triples as terms — required for `annotateSource` to bake in; if unsupported, `annotateSource` on a disk-backed glob becomes a parse error instead **(resolved — see below)**. Confirm quadstore's batch/stream import path (the published ~44k quads/s figure is one-by-one import). Pick the soft byte-hint threshold for the un-flagged-glob warning.

## Verification outcome — RDF-star in quadstore (#341)

Verification item 1 is **resolved**: `quadstore` (15.4.1) does **not** store RDF-star quoted triples as terms. A probe built an index whose annotation subject was a quoted triple `<<s p o>>`; the term round-tripped out of the embedded quad store as a corrupted `NamedNode`, not a `Quad`. The Comunica query engine additionally does not enable SPARQL-star, so the pattern would not be queryable even if the term survived.

Per this ADR's own contingency, `annotateSource` on a disk-backed glob is therefore a **parse error**, not an allowed-with-warning transform: a glob declaring both `storage: disk` and an `annotateSource` transform fails `parseSourceSpecs`, with a message naming `storage: disk` and pointing the user to `storage: memory`. A **split glob**'s File-source children inherit `storage` and `transforms`, but the meta fails parsing first, so the children are never synthesized — no separate check is needed.

`graphName` only rewrites the graph term — a `NamedNode` or `DefaultGraph`, never a quoted triple — so it bakes cleanly and remains the one transform supported on the disk tier.
