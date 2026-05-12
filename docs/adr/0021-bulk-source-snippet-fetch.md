---
status: accepted
amends: 0011, 0012
---

# Bulk source-snippet fetch — many ranges, one request

## Context

ADR-0011 stood up `GET /api/source-snippet?file=<file://uri>&line=N&context=K` as a per-snippet primitive: one focal line, one `SnippetReadResult` back. ADR-0012 renamed the `context` query param to `snippetContext` (and later work added an optional `endLine` for multi-line focal ranges). The core reader `readSourceSnippet` streams the file once per call and stops at `focalEnd + context`.

But a single **diff hunk** carries many **Source records** — often several per side, each its own (file, line) — and after **Snippet range merging** the diff page renders one `<app-source-snippet>` per surviving range. Each component fetched independently, so one hunk meant N HTTP round-trips, and a hunk-heavy diff page meant N × (hunks) GETs, every one re-opening (frequently) the *same* source file and streaming from the top again. The disclosure is already paid for (the loader read those bytes; they're inside the trust boundary ADR-0011 reasoned about) — the cost being paid needlessly is request count and redundant streaming, not exposure.

## Decision

**`GET /api/source-snippet` takes one or more `range` params and answers with an array.** The query is `file=<file://uri>`, `snippetContext=K`, and one-or-more `range=<spec>` where `<spec>` is `N` (single-line focal) or `N-M` (1-based, inclusive, `M ≥ N`). The response is `{ snippets: SnippetReadResult[] }` — one entry per requested `range`, in request order. The `line` / `endLine` params are gone; a single-line snippet is just `range=N`.

**Core gains `readSourceSnippets(path, ranges[], K)` — one stream pass for the whole batch.** It reads `[min(focalStart − K) .. max(focalEnd + K)]` once (truncated at file bounds), buffering only the lines some requested window needs, stops at the highest upper bound, then slices per range; each range independently reports `beyond-eof` / `empty`, and a filesystem failure (`missing` / `not-a-file`) fills every entry with that reason. `readSourceSnippet` (and the iterator-level `readSnippetFromLines`) become thin single-range wrappers over the bulk forms — one implementation, the streaming "read to the union upper bound, then stop" contract verifiable without filesystem I/O.

**The webapp coalesces transparently.** `SnippetService.fetch(file, range, snippetContext)` returns an `Observable<SnippetReadResult>` but defers: calls made within the same microtask for the same `(file, snippetContext)` are batched into one GET carrying a `range` param per call, and the response's `snippets[]` is fanned back out to each caller in order. So every `<app-source-snippet>` rendered in one change-detection pass — across all hunks — produces one request per source file. `SourceSnippetComponent` stays presentational with the same inputs; `diff-hunk.component.ts` is untouched.

**File-level problems are per-entry `unavailable`, not HTTP 404.** When the allow-listed file has disappeared (`missing`) or is a directory (`not-a-file`), the response is `200 { snippets: [{ kind: 'unavailable', reason }, …] }` — one entry per requested range. `400` (validation: bad/missing `range`, non-`file://` URI, …) and `403` (path outside the loader allow-list) are unchanged, as is the allow-list itself (the static set of absolute paths the loader opened, refreshed on every `--watch` rebuild, registry-wide).

## Considered alternatives

- **Keep one GET per snippet.** Rejected: that's the status quo whose N-round-trips-per-hunk and N-redundant-streams-of-the-same-file this ADR removes. The snippet primitive was specced per-line in ADR-0011 before the diff page existed; the hunk → many-records shape makes per-file batching the natural unit.
- **`POST /api/source-snippet` with a JSON body of ranges.** Rejected: snippet reads are idempotent and cacheable; a GET with repeated query params is the conventional shape for "fetch these N things," keeps the endpoint uniform with the rest of `serve`'s read-only surface (`/api/sparql/<id>`, `/api/sources`, `/api/config`), and the per-file range count is small (post-merge, a handful).
- **A separate batch route (`/api/source-snippets`, or a token-keyed bundle handed out by `/api/diff`).** Rejected: a new route for the same primitive at a different arity is surface bloat; evolving the existing route keeps one endpoint, one allow-list check, one mental model. (ADR-0011 already rejected a per-session snippet token for the security angle; nothing here revives it.)
- **Keep 404 for a wholly-missing file.** Rejected: a bulk response covers exactly one file, so the file-gone signal is already unambiguous in the body, and the diff page renders `(source file unavailable)` per snippet from the `unavailable` entry regardless. A status code would force the client to special-case "the whole batch failed" separately from "this one range is `beyond-eof`" for no gain; uniform per-entry `unavailable` is simpler. `400` and `403` stay distinct because they're *request* faults, not per-range outcomes.
- **Have `SourceSnippetComponent` keep fetching, drop the batching.** Rejected: then the new bulk endpoint buys nothing for its only client. Microtask-level coalescing in `SnippetService` exploits it without restructuring the diff-hunk template or moving fetch orchestration up the tree.

## Consequences

- **`libs/core`**: `source-snippet-reader.ts` gains `readSourceSnippets` / `readSnippetsFromLines` (single-pass, multi-range, ordered results) and exports `FocalRange`; `readSourceSnippet` / `readSnippetFromLines` are kept as single-range delegators. `html-diff-composer.ts` (the other consumer of `readSourceSnippet`) is unchanged — the HTML diff path still calls the single-range form directly.
- **`libs/server`**: `SnippetController` query schema is `file` + `snippetContext` + repeated `range` (`N` or `N-M`); response is `{ snippets: SnippetReadResult[] }` aligned to the `range` order. `missing` / `not-a-file` no longer maps to `404`; `400` / `403` unchanged.
- **Webapp**: new `SnippetService` (per-file, per-tick request coalescing) under `pages/diff/services/`; `SourceSnippetComponent` fetches through it instead of `HttpClient`; `diff-hunk.component.ts` and the diff-result renderer are untouched.
- **CONTEXT.md**: **Source-file snippet** updated for the `snippetContext` + multi-`range` query and the `{ snippets: [...] }` response (one request per source file per hunk).
- **Breaking web API change**: `GET /api/source-snippet` no longer accepts `line` / `endLine`; callers send `range=N` / `range=N-M`. The response is `{ snippets: [...] }`, not a bare `SnippetReadResult`. A vanished file returns `200` with `unavailable` entries, not `404`. Pre-1.0; the only client is the webapp, updated in lockstep.
- **ADR-0011**: its `?file&line&context` query shape and bare-`SnippetReadResult` response are superseded by this ADR; the primitive itself — always-on, allow-list-gated to loader-opened files, registry-wide, with the trust-boundary rationale — stands.
- **ADR-0012**: its `--snippet-context K` rename and the `snippetContext` query param name stand; only the single-range `?...&line=N` shape it described is superseded here.
