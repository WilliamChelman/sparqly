---
status: accepted
supersedes: 0008
amends: 0006, 0007, 0027, 0029
---

# Loader-attached source-record sidecar

## Context

ADR-0006 introduced **Source records** as an RDF-star projection authored by the explicit-opt-in `annotateSource` transform — `<<:s :p :o>> sparqly:source [ sparqly:file …; sparqly:line N ]` — and rejected a side-channel `WeakMap<Quad, {file,line}>` alternative on the grounds that it would kill the "SPARQL over which-file-said-this" use case for human and agent consumers of `query` / `serve`.

ADR-0008 then patched the awkward seam this created on `diff`'s CLI: bare-glob invocations had no place to declare the transform, so HTML diff output came out empty. The fix was to auto-prepend `annotateSource` to every glob/file diff target at request time, opt-out via `--skip-auto-source-annotation`, with an explicit declaration winning if present.

Two changes since ADR-0008 made the auto-injection design's costs visible:

1. **ADR-0031 (lazy materialization in `serve`)** landed an `engine-map` cache that memoizes one `(Store, engine)` per source-id for the life of the process. The diff service cannot read from it: `withAutoSourceAnnotation` wraps a fresh `ParsedSource` with the implicit transform, then calls `resolveSourceResult` directly. So every diff request pays a second full materialization of sources that `serve` has already loaded.

2. **The queryability use case stayed speculative.** No code in the repo (and no documented workflow) reads `<<s p o>> sparqly:source …` triples back through SPARQL. The "humans and AI agents SPARQL over provenance" angle remains a hedge, not a present-tense consumer. Meanwhile `diff` (the only present-tense consumer) doesn't run SPARQL against the RDF-star at all — it extracts records back out through `extractSourceRecordMap`, walking the same Store the transform just wrote into.

Result: the production path for diff's source records is "transform writes RDF-star into the Store; canonicalizer strips RDF-star; diff walks the stripped-from set back out of the Store to rebuild a side-map." The trip through the Store is load-bearing for *nothing* the user actually reads, and structurally it forces diff to operate on a `ParsedSource` it has mutated — a registry-shared object — so it cannot share resolution with `engine-map`.

## Decision

**Move source-record production into the loader, as a sidecar carried alongside the loaded Store. Delete `diff`'s auto-injection. Retain `annotateSource` as an explicit-opt-in queryability projection only.**

- The glob/file loader emits a **Source record sidecar** for every materialized load: a `Map<(s, p, o), SourceRecord[]>` keyed graph-agnostically, with entries `{ file, line?, endLine?, gitRef?, gitSha? }`. The parser already surfaces line offsets to feed `annotateSource` today; that plumbing is reused.

- `resolveSourceResult`'s materialized variant grows the sidecar slot: `{ mode: 'materialized', store: Store, sourceRecords?: SourceRecordSidecar }`. Pass-through and view resolutions carry no sidecar (no per-quad file/line provenance is recoverable).

- `engine-map` caches `(Store, sourceRecords?, engine)` per source-id. `/api/sparql`, `describe`, and every non-diff consumer ignores `sourceRecords`; `diff` reads it.

- `DiffService.resolveGraphSide` reads from `engine-map` for declared sources, dropping the `withAutoSourceAnnotation` wrap and the separate `resolveSourceResult` call. The duplicated materialization that current `serve` pays per diff request collapses to one.

- `diffStores` accepts `sourceRecords?: SourceRecordSidecar` on each `DiffSideStore` and re-keys it by canonical N-Quads using the canonicalizer's blank-node label map. The fan-out across graphs (one sidecar entry → all per-graph canonical keys of the same triple) matches what `extractSourceRecordMap` does today. `extractSourceRecordMap` is deleted.

- `extractAnnotationPredicates` stays, narrowed to its remaining job: telling the canonicalizer what to strip when an explicit `annotateSource` is declared. It no longer feeds source-record extraction.

- `annotateSource` keeps its existing config schema, predicate-IRI configurability, and behavior of injecting RDF-star into the Store. It is no longer auto-prepended by any command, and its output is not read by `diff`. Users who declare it do so for the SPARQL-queryability use case ADR-0006 anticipated.

- `--skip-auto-source-annotation` (CLI flag), the `Skip auto source annotation` web checkbox, and the `skipAutoSourceAnnotation` project-config field are deleted. Their two historical motivations (avoid Store pollution; avoid build cost) have no referent under the sidecar.

- Split-glob children inherit the sidecar by construction: each child loads its own file and produces its own (one-file) sidecar. The meta's sidecar is the union, mirroring ADR-0027's transform-inheritance posture.

- Pinned-source `gitRef` / `gitSha` populate at the loader since the loader holds the pin context (`gitRef` is resolved before the file read). User-facing surface — gitRef/gitSha visible per record in HTML/turtle/json diff outputs — unchanged.

## Considered alternatives

- **(B) Opt-in sidecar at resolve time** (`resolveSourceResult({ withSourceRecords: true })`). Rejected: the consumer (diff) tells the loader what to compute, which is morally the same anti-pattern `withAutoSourceAnnotation` exhibits, just relocated. The unconditional sidecar is also cheap: O(quads) bookkeeping during a parse pass that already iterates every quad, memoized in `engine-map` for the process lifetime.

- **(C) New `recordSource` transform that writes to a sidecar slot instead of into the Store.** Rejected: keeps transforms as the single declarative surface but splits the pipeline contract from "Store → Store" to "Store + sidecar → Store + sidecar," and reintroduces the auto-prepend mechanism (the very thing being removed). The loader is the right layer because the sidecar exists for *every* glob/file load regardless of any declared pipeline.

- **(D) Hybrid: keep auto-injection but also emit the sidecar.** Rejected: produces the same data twice and forces a precedence rule between RDF-star-extracted and sidecar records. The sidecar is strictly more direct.

- **Delete `annotateSource` entirely.** Rejected at the user's direction: the SPARQL queryability use case ADR-0006 anticipated is preserved as a hedge. The transform is now strictly additive and independent of diff.

- **Repurpose `--skip-auto-source-annotation` as "exclude source records from output."** Rejected: build-but-hide flags age poorly, and no existing consumer treats records as noise.

## Consequences

- **Diff `/api/diff` and CLI `diff` reuse `engine-map`'s memoized Store for declared sources.** A diff request after `serve` has warmed an engine pays only the canonicalization and diff cost, not a fresh load. CLI `diff` against on-disk globs is unchanged in cost.

- **Per-request `ParsedSource` mutation is gone from the diff path.** `DiffService` reads from the registry by id and never wraps. Future commands that want per-quad provenance can read the same sidecar from `engine-map` without inventing their own injection mechanism.

- **Breaking removals (pre-1.0, no compat shim):** `--skip-auto-source-annotation`, the `skipAutoSourceAnnotation` config field, the web `Skip auto source annotation` checkbox, `withAutoSourceAnnotation` (`libs/core`), and `extractSourceRecordMap`. Configs setting `skipAutoSourceAnnotation` fail with a Zod `unrecognized key` error — same migration UX ADR-0006/0008 used for the `annotate` → `annotateSource` rename.

- **Diff output unchanged.** Every renderer (`html`, `turtle`, `json`, `human`, `rdf-patch`) continues to receive a `Map<canonicalQuadKey, SourceRecord[]>` per side. The map's contents and shape are identical to today's for any glob/file target; only the production path differs.

- **CONTEXT.md vocabulary shift.** **Source record** redefined as the in-memory struct; **Source record sidecar** added; **Annotate-source transformation** rewritten as a queryability projection independent of the sidecar; **Auto source annotation** deleted. The "Flagged ambiguities" section records the term move.

- **ADR-0006**: amended — the side-channel `WeakMap` alternative it rejected is now adopted as the canonical diff path. The transform itself stands; its motivation narrows from "the way provenance reaches every consumer" to "the way provenance becomes SPARQL-queryable."

- **ADR-0007**: amended — the HTML format's source-snippet rendering is unchanged user-side; the per-side `SourceRecord[]` map it consumes now arrives from the sidecar rather than from RDF-star extraction.

- **ADR-0008**: superseded in full — auto-injection, opt-out flag, and the per-command carve-out have no referent under the sidecar.

- **ADR-0027**: amended — split-glob children inherit the parent meta's sidecar by carrying their own (one-file) sidecar, paralleling the transform-inheritance note.

- **ADR-0029**: amended — `gitRef` / `gitSha` populate from the loader's pin context into `SourceRecord` fields directly; no RDF-star round-trip.

- **ADR-0031**: unchanged in contract. `engine-map`'s memoized cache entry gains an optional `sourceRecords` field; the lazy-materialization timing is untouched.

- **`SourceSnippetController` allow-list (ADR-0011 / ADR-0021)**: unchanged — still derives from loader-opened paths, which the sidecar enumerates by construction.
