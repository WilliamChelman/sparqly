---
status: accepted
amends: 0003, 0041
---

# Pass-through `hash` and `diff` on disk-backed globs

## Context

ADR-0041 stood up the **Disk-backed glob** tier and made `hash` and `diff` **reject** it outright, calling the rejection *"a deliberate, named capability gap"* on the grounds that *"RDFC-1.0 canonicalization needs every quad in memory ... and would OOM regardless of where the quads are stored."* That framing assumed `hash @disk-backed-glob` meant "canonicalize all 30 M quads." It did not consider the case where the user supplies a scoping query — inline `--query`, or via a wrapping **View** — which bounds the result to a size canonicalization can actually handle.

The same asymmetry exists for **Endpoint sources**: a raw endpoint target is rejected today (CLI errors point at *"wrap the endpoint in a `view` source kind ... or pass `--query`/`--query-file` to scope it inline"*), but once the query exists, the endpoint resolves via **pass-through**, returns a bounded Store, and canonicalizes fine. ADR-0003 fixed pass-through to the endpoint kind specifically.

The two source kinds are mechanically the same when scoped: both run the user's query against a SPARQL-capable store they own (remote HTTP endpoint vs. local on-disk **Glob index**) and return only the result. The disk-backed case is gated only by a missing resolver path — the engine plumbing already exists (ADR-0041 wired the quadstore into Comunica via `sources: [...]`).

The user-facing rough edge: a 6 GB disk-backed glob is `query`-able under `serve`, but the only way to hash or diff *any subset of it* is to abandon `storage: disk`, blow the heap, and crash. The capability gap is wider than the underlying constraint requires.

## Decision

**Extend pass-through resolution to disk-backed globs end-to-end; narrow the `hash`/`diff` rejection to *raw* pass-through targets only.**

- **Pass-through resolution generalised.** Pass-through is the resolution path for any source whose own store answers SPARQL queries — remote endpoint or local **Glob index**. Materialised resolution stays the path for in-memory glob, empty, and view upstreams. `CONTEXT.md` already shifted to match.

- **New resolver path.** A **View** whose `from:` chain reaches a **Disk-backed glob** resolves via pass-through: the view's query runs against the **Glob index** through the existing Comunica engine (RDF/JS `Store` source, same engine the `query` command already uses), and the bounded result Store is returned to the caller. Under `serve`, the resolver reuses the EngineMap-memoized quadstore handle (ADR-0031/0041); under the CLI, it opens the index, runs the query, and `close()`s the handle in the same lifecycle as today's endpoint path.

- **Raw-target rejection, unified.** `hash` and `diff` reject a raw pass-through target — endpoint *or* disk-backed glob — on the grounds that the canonicalization step has no scoping query and would materialise the whole upstream. One parametrised error template names the source ("endpoint `<url>`" or "disk-backed glob `<label>`") and the affordance (wrap in a `view`, pass `--query`/`--query-file`, or pipe `sparqly query --format=turtle`). The rejection lives at the raw-target check, not at the resolution-mode check.

- **No `--force` escape hatch.** The "load it all into RAM anyway" path is not exposed: the scoping-query requirement *is* the safety contract, and a force flag would re-create the OOM ADR-0041 exists to prevent. Users who genuinely want every quad have always been able to declare a CONSTRUCT view that says so — explicitly.

- **Guards removed.** The unconditional rejections at `apps/cli/src/app/commands/hash.ts:406-411`, `apps/cli/src/app/commands/diff/side.ts:105-113`, and the view-resolver disk-backed rejection at `libs/core/src/lib/views/view-resolver.ts:305-314` are deleted. The over-broad pass-through guard at `hash.ts:401-404` is also deleted: with the new resolver returning a Store-bearing mode for view-over-pass-through, the only legitimate caller of a raw pass-through guard is the raw-target branch at `hash.ts:390` (extended to disk-backed) and its `diff/side.ts:85` sibling.

- **Webapp pre-flight gate.** The diff page disables Run when a selected side is a raw pass-through source (endpoint or disk-backed glob) with an empty query field, and surfaces an inline "this source needs a scoping query" hint. The server guard is the source of truth — the client gate is a UX shortcut, not a security boundary.

- **Source-record sidecar degradation, warned.** A `diff` graph-diff side resolved via pass-through carries no **Source record sidecar** (ADR-0041's deliberate trade-off). Diff runs; the `html` format's **Source-file snippet** sections render empty. One boundary-log `warn` per such side names the source and explains the suppression, matching the posture ADR-0028 (empty-glob warning) and ADR-0041 (oversized-glob warning) took for adjacent cases.

## Considered alternatives

- **Keep the blanket rejection (status quo).** Simplest. Rejected: blocks the real, motivating use case — scoping queries against a disk-backed glob are precisely what the on-disk index *is for*, and the engine already supports it. The capability gap is wider than the underlying constraint.

- **Add a `--force` / `force=true` flag that bypasses the rejection and loads the whole upstream into RAM.** Considered explicitly. Rejected: re-introduces the OOM ADR-0041 exists to prevent, gives users a one-flag foot-gun, and the legitimate "I want everything" case has a clean expression already — declare a view with a `CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }` body. An explicit view is reviewable; a flag isn't.

- **Coin a separate resolution kind for the disk case** (e.g. *Index-local resolution*), keeping pass-through tied to remoteness. Rejected: pass-through is defined by *where the query executes* and *what gets materialised*, not by network distance. Splitting the term forces every downstream rule ("hash rejects raw X") to enumerate two kinds where one suffices.

- **Gate at the resolution layer instead of the raw-target layer** (let `resolveSourceResult` flag "pass-through-mode" results and have `hash`/`diff` reject the mode). Rejected: that is exactly the over-broad `hash.ts:401-404` guard the new path requires deleting — it false-positives on the legitimate view-over-pass-through case. The clean place to reject is at the target *kind* check, before resolution runs.

- **Persist a sidecar alongside the **Glob index** so diff keeps source snippets.** Already rejected in ADR-0041 on cost grounds, and the new path doesn't change that calculus. Diff against a disk-backed-glob-derived side still has no snippets; the new `warn` makes the gap visible instead of silent.

## Consequences

- **`hash` and `diff` gain a real capability** against the largest sources in the project — the use case the on-disk index exists to support. A user can hash a 100 k-triple subset of a 30 M-triple disk-backed glob without crashing the process.

- **`CONTEXT.md` vocabulary already shifted**: **Pass-through resolution** generalised; **Disk-backed glob** marked as resolving via pass-through; the `hash`, `diff`, and disk-backed-glob relationship lines rewritten.

- **ADR-0003 amended.** Pass-through is no longer endpoint-only — it is the resolution path for any source whose own store answers SPARQL.

- **ADR-0041 amended.** *Scope* and *Consequences*: the capability gap is narrowed from "`hash`/`diff` reject disk-backed globs" to "`hash`/`diff` reject *raw* disk-backed globs (and *raw* endpoints, unchanged) — both require a scoping query." The underlying RDFC-1.0 constraint stands; the trigger for hitting it is now the absence of a scoping query, not the storage tier.

- **Server-side surface**: the diff HTTP route's guards collapse from "reject endpoint OR disk-backed" to "reject raw pass-through target." Hash remains CLI-only.

- **Webapp diff page** picks up the pre-flight gate and the inline hint. No new server endpoint required.

- **CLI error template** unifies. Two callsites today (endpoint, disk-backed) collapse to one parametrised template across `hash` and `diff`; future pass-through source kinds (if any) plug into the same template.

- **Quadstore RDF-star constraint propagates.** A view body that pattern-matches on quoted triples (RDF-star) returns empty against a disk-backed upstream — same constraint ADR-0041 already established for direct `query`. Not a new failure mode; surfacing it here so the next reader of the new resolver path doesn't expect otherwise.
