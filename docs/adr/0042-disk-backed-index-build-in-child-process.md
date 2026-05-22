---
status: accepted
amends: 0031, 0041
---

# Disk-backed Glob index build in an isolated child process

## Context

ADR-0041's background build runs in the `serve` process. Quadstore's `multiPut`
synchronously builds one LevelDB batch per call (6 index permutations per quad);
on a multi-GB glob that is a multi-minute synchronous block of `serve`'s single
event loop — the webapp is unreachable for the duration. There is also no
progress visibility: only `index-build-start` / `-complete` fire, so a build is a
silent ~10–15-min black box.

## Decision

Move the build into an isolated child process. `serve` spawns `sparqly index @id`
(a new standalone command sharing one core build function) per disk-backed source,
capped at `index.concurrency` (default 2) concurrent children. The child has its
own event loop, libuv threadpool, and heap, so the webapp loop never blocks and a
build OOM kills only the child (`serve` reports the source `failed`).

Builds use streamed batched ingest (parser → ~10k-quad batch → `multiPut`) and
apply the per-quad `graphName` rewrite inline, so a disk-backed build never
materializes the whole glob — child memory is flat with or without a transform.
The build writes into a temp dir and atomic-renames it to the real index path only
after the manifest is written; on `serve` shutdown the child is SIGTERM'd and its
partial temp dir is swept on the next build, so a killed build never leaves a
half-index at the real path. Progress is reported via `index-file-start` /
`index-file-done` and a time-throttled `index-progress` heartbeat (byte-%, quads,
elapsed, rate), all at `info`, reaching `serve` by stderr inheritance — no IPC.

The standalone `sparqly index` command builds every disk-backed glob in the
registry (or selected `@id`s), skipping already-fresh indexes and rebuilding stale
ones; `--force` rebuilds regardless.

## Considered alternatives

- **Worker thread.** Isolates the synchronous-JS clog but shares the process-wide
  libuv threadpool (LevelDB writes still contend with static-asset reads) and the
  heap (a build OOM crashes `serve` — the exact failure ADR-0041 exists to escape).
- **Cooperative in-process yielding.** Smallest change, but leaves the webapp
  sluggish and CPU shared, and the transform path stays a synchronous block.
- **`serve` no longer builds — require `sparqly index` first.** Reverses ADR-0041's
  "background build on first touch / `serve` is self-sufficient" contract for a
  two-step workflow. Rejected: the child process keeps `serve` self-sufficient
  while still de-clogging it.

## Consequences

- Amends ADR-0041: the background build is now a child process, not in-process;
  the build never materializes the whole glob (streamed ingest + inline `graphName`).
- Amends ADR-0031: the `indexing` state covers "build child running or queued."
- New public surface: the `sparqly index` command and the `index.concurrency`
  config key (sits in the `index:` block alongside the config-overridable cache
  location from #345).
- Build events fire at `info` (default-on) — an extension of ADR-0020's levels,
  consistent with `index-build-start` / `-complete` already being `info`; a
  ~15-min build is categorically unlike the fast source-load ADR-0020 put at `debug`.
- Webapp progress surfacing is deliberately out of scope: the child → `serve` link
  is pure stderr inheritance, so `serve` holds no structured progress and the
  `503` body stays bare `indexing`. Adding an IPC channel later is non-breaking.
