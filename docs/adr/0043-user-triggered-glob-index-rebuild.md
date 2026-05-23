---
status: accepted
amends: 0041, 0042
---

# User-triggered Glob index rebuild via the Sources page

## Context

ADR-0041 made `serve`'s only path to a built **Glob index** an automatic
first-touch background build; ADR-0042 moved that build into an isolated child
process under `IndexBuildPool` and pinned the temp-dir → atomic-rename pattern
that keeps a killed build from leaving a half-index at the real path. There has
been no path to **rebuild** an already-`ready` index from inside `serve`: a
manifest mismatch (files changed, sparqly version differs, transform pipeline
re-pointed) is logged as a `warn` and surfaces nowhere else; the operator must
delete the index directory and restart `serve` to clear staleness.

The new **Sources page** (CONTEXT.md) needs a first-class rebuild trigger,
because the same surface that exposes the **Glob index** state machine also
exposes its `stale` state — and without a user-issued recovery, `stale` is a
dead-end indicator. The rebuild needs cancel semantics too: a mistaken
**(Re)build** on a multi-GB glob, watched ticking for 20 minutes, is the kind
of operator mistake that should be one click to undo, not a `serve` restart.

## Decision

- **Add a rebuild operation on `IndexBuildPool`,** triggerable from the
  **Sources page** via `POST /api/sources/:id/index-build` and idempotent for
  the lifetime of one in-flight build (concurrent triggers coalesce onto the
  same child). Initial-build and rebuild are the same operation as far as
  `IndexBuildPool` is concerned — both spawn `sparqly index @id`, both write
  into the temp dir, both atomic-rename on success. The trigger is gated by
  the **Source admin actions capability** (ADR-0045) and returns `202 Accepted`
  with the entry's new state (`indexing`) — the operation never blocks on
  build completion.
- **Cancel is a peer operation.** `DELETE /api/sources/:id/index-build`
  SIGTERM's the child via `IndexBuildPool.cancel(id)` and sweeps the temp dir.
  Because the build child only writes into the temp dir until the very final
  rename, a cancelled rebuild always leaves the **previous** Glob index intact
  at the real path; a cancelled initial build leaves no index, exactly as
  today. Cancel is gated by the same capability flag.
- **The rebuild trigger is the only path that clears `stale`.** A `stale`
  entry stays `stale` until an explicit rebuild succeeds — no silent rebuild
  on next query touch, no startup auto-rebuild. The asymmetry with in-memory
  globs (which the watcher rebuilds automatically on file change) is
  intentional: disk-backed rebuilds can take minutes, and silently kicking
  one off on `serve` boot or first query touch is exactly the surprise the
  staleness `warn` was added to avoid.
- **The destructive trigger requires a confirm dialog on the page.** A
  rebuild against a `ready` or `stale` index — the cases where rebuild
  discards meaningful built-up state on success — opens a confirm modal.
  A rebuild against `not-built` or `failed` (no `ready` state to lose) skips
  the confirm.

## Considered options

- **Auto-rebuild on detecting a stale manifest.** Rejected. Disk-backed
  builds can be 10–15 minute jobs; turning every `serve` boot or first touch
  of a stale source into one is exactly the silent-cost surprise ADR-0041's
  staleness `warn` was written to avoid. Keeping rebuild explicit makes
  the cost the operator's choice.
- **Rebuild in place, no temp dir.** Rejected. Today's temp-dir pattern
  (ADR-0042) means a killed build cannot corrupt the live index — a property
  cancel-during-rebuild relies on. Building in place would force "rebuild
  is a destructive operation that risks the live index on cancel," which
  changes the cancel UX from "cheap, always-safe undo" to "scary, sometimes-
  recoverable."
- **Cancel by deleting the queued/running entry from the pool only.**
  Rejected. Without SIGTERM the child keeps running until completion,
  burning CPU and disk on a build the user disowned. The pool already
  SIGTERM's children on `serve.close()`; this decision extends that to
  per-entry cancel.
- **Couple rebuild to in-memory Reload under one verb on the API and UI.**
  Rejected during grilling. The destructive/non-destructive asymmetry is
  real (Reload is an atomic `StoreRef` swap, idempotent; Rebuild discards
  on-disk state and takes minutes) and conflating them under one button
  hides the cost asymmetry from the operator.

## Consequences

- Amends ADR-0042: the `IndexBuildPool` gains a public `cancel(id)`
  method beyond the existing shutdown SIGTERM, and the temp-dir pattern is
  now relied on for the cancel-preserves-old-index property, not only the
  shutdown-doesn't-corrupt-real-path property.
- Amends ADR-0041: the **Glob index** `stale` state is now a first-class
  state surfaced on `/api/sources` (ADR-0044), not just a boundary warn log;
  the user-facing clearing path is the explicit rebuild trigger.
- The CLI's existing `sparqly index @id` command continues to use the same
  build path — symmetry between CLI initial build, `serve` auto-trigger
  build, and `serve` user-triggered (re)build is preserved.
- No new manifest-schema migration is required to land this ADR — the
  `quadCount` field that the **Sources page** displays for `ready` disk-backed
  entries (CONTEXT.md) is a forward-compatible additive field on new manifests
  and is shown as `undefined` for indexes built before the change.
