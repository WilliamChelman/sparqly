---
status: accepted
amends: 0031
---

# Off-main-thread worker pool for in-memory query isolation

## Context

`serve` runs every SPARQL request on the one Node event loop. An in-memory
**materialized** query (Comunica over an `n3.Store`) does long *synchronous*
CPU stretches — building hash-join tables, scanning the store's nested indexes —
*between* its async yields. The query path is already `await`ed and streamed
(`engine.query(...)` then `for await (const b of stream)` in
`query-engine.ts`), so this is **not** a missing `await`: it is CPU-bound work
that must leave the main thread. While one complex query runs, every other HTTP
request — the SSE source-state stream (ADR-0044), `/api/config`, static assets,
and queries against *other* sources — hangs until it finishes.

ADR-0042 already moved a heavy workload off the loop (the disk-backed index
build) and chose a **child process**. But that workload is I/O-bound, native
(LevelDB / `classic-level`), and OOM-prone, and 0042's two reasons for a process
were the shared libuv threadpool and an unbounded-build heap crash. An in-memory
query is the opposite workload — CPU-bound and pure-JS — so it warrants a
different tool. This ADR is the complement to 0042, not a reversal of it.

Goal, pinned during grilling: **isolation, not throughput.** The only thing that
must stop is one query freezing all other requests. Running two heavy queries
*faster* is explicitly out of scope.

## Decision

Move in-memory materialized query execution onto a **bounded `worker_threads`
pool**, fronted by `EngineMap`.

- **`worker_threads`, not child processes.** The workload is pure JS, so 0042's
  libuv-contention reason does not apply, and `resourceLimits.maxOldGenerationSizeMb`
  per worker turns an OOM into a catchable `ERR_WORKER_OUT_OF_MEMORY` that kills
  only the worker (main respawns it) — neutralizing 0042's heap-crash reason
  in-thread. Threads spawn cheaper and carry a lighter per-worker baseline.

- **In-memory scope only.** Endpoint pass-through stays on the main loop (I/O-bound,
  already cooperative — offloading adds a hop for no benefit). Disk-backed glob
  queries stay on their current path (scoping their native quadstore reads *out*
  keeps the pool pure-JS and keeps the native-segfault failure mode away from the
  shared process). See *Consequences* for the named gap this leaves.

- **`EngineMap` is the pool front.** `QueryEngine` stays synchronous and runs
  *unmodified inside* a worker — the same localization ADR-0031 used when it
  hoisted async into `EngineMap.ensure`. Controllers stay thin and thread-unaware.
  The worker **builds and owns the store** (parsing therefore also leaves the main
  loop); `loading → loaded → failed` transitions originate in the worker and are
  messaged back to a thin **state mirror** in main that feeds the SSE ring buffer
  (ADR-0044). The worker↔main protocol carries both query RPCs and lifecycle events.

- **Bounded pool, pure hash-sticky assignment.** Pool size is `query.concurrency`
  (default **2**, mirroring `index.concurrency` / `IndexBuildPool`). A source maps
  to a fixed worker by `hash(id)`, so its store is built and memoized on exactly
  one worker — no duplication. The assignment function is an **injectable strategy**
  so a size-aware or sticky-with-overflow policy can replace it later without
  touching the pool seam.

- **Per-worker LRU-bounded residency (amends ADR-0031).** Each worker enforces its
  own resident budget (`query.maxResidentQuads`, defaulted high enough that typical
  small registries never evict) and LRU-evicts its own idle stores; a store with an
  in-flight query is pinned and never evicted. LRU is the soft governor under the
  `resourceLimits` hard ceiling — both per-worker. **Residency and routing are
  orthogonal:** a query for an evicted source still routes to its sticky worker,
  which rebuilds it. Pinned/ad-hoc sources (git-SHA globs, pinned views) route the
  same way, keyed by resolved SHA, closing an isolation hole where they currently
  bypass `EngineMap` and execute on the main loop.

- **Hybrid cancellation (load-bearing, not polish).** With a bounded pool, abandoned
  long queries would exhaust the workers and re-create the original hang. On client
  disconnect (`req` `close`/`aborted`) the pool posts a cancel and destroys the
  Comunica stream; if the worker does not acknowledge within a short grace window
  (it is stuck in a synchronous stretch, the exact case this work targets),
  `worker.terminate()` and respawn. Cooperative loses no memoized stores; nuclear
  reclaims the truly-stuck worker at the cost of re-parsing its sources.

## Considered alternatives

- **Child processes (ADR-0042's choice).** Over-isolates a pure-JS workload:
  native-segfault isolation is moot once disk-backed is scoped out, and you pay
  heavier RSS and slower spawns to contain a failure mode that no longer exists in
  scope. `resourceLimits` gives thread-level OOM containment without it.
- **One shared query worker.** Simplest and lowest memory, but a future
  `SERVICE`-across-local-sources query would route a sub-query back
  into the single busy worker → a self-blocking deadlock. Demoted by the federation
  requirement of ≥2 concurrent executors.
- **Unbounded one-worker-per-source.** Clean 1:1 with `EngineMap` entries and zero
  federation placement logic, but each worker replicates the Comunica/n3 module
  graph (~40–90 MB) *per touched source*, scaling overhead with registry size for a
  benefit (cross-source throughput) that is out of scope.
- **Stateless worker pool (re-parse per query).** No main-heap stores at all, but
  forfeits memoization — every request re-pays the parse cost ADR-0031 exists to
  defer.
- **In-memory + disk-backed scope.** Pulls quadstore/`classic-level` (native N-API)
  into the workers, reviving both of 0042's objections (libuv contention + a native
  crash that isn't thread-contained). Deferred as a named follow-up.
- **Least-busy / work-stealing dispatch.** Best utilization and same-source
  concurrency, but a source's store gets rebuilt on whichever worker grabs the
  query — duplicating memory and re-paying parse, fighting the memoized steady state.
- **Global, main-coordinated LRU.** One unified memory ceiling, but main must track
  per-store sizes across the thread boundary and coordinate eviction, and it fights
  the per-worker `resourceLimits` backstop. Per-worker LRU needs no coordination.
- **Cooperative-only / nuclear-only cancellation.** Cooperative-only provably fails
  to reclaim the single-synchronous-stretch query (the worker never processes the
  cancel ping); nuclear-only always pays store-loss even for queries that would stop
  in milliseconds.

## Consequences

- **Amends ADR-0031.** Its "*memoized for the life of the process*" contract becomes
  an LRU-bounded resident set, and the store is now built *in the worker* rather than
  the main heap. `CONTEXT.md`'s **Lazy materialization** definition (which still says
  "for the life of the process") is updated when this ships, not before — the glossary
  tracks the code.
- **Complements ADR-0042.** The repo now offloads two workloads two different ways on
  purpose: I/O-bound native build → child process; CPU-bound pure-JS query → worker
  thread. A reader asking "why threads here when 0042 chose processes?" finds the
  answer here.
- **Named gap — disk-backed glob queries.** They stay on the main loop, so a heavy
  Comunica join over quadstore can still starve it. Logged as a follow-up; closing it
  would reopen the threads-vs-processes choice for the native tier (`ideas.md`).
- **Federation inherits a placement obligation.** Hash-sticky can co-locate two
  `SERVICE` participants on one worker, re-introducing the deadlock the single-worker
  option was rejected for. The future federation router must detect co-location and
  spill the sub-query to a different worker. Not solved here; named so it isn't
  discovered.
- **New public config.** A `query:` block: `query.concurrency` (default 2) and
  `query.maxResidentQuads` (per-worker LRU budget).
- **Worker crash/respawn.** A `resourceLimits` OOM or unexpected exit rejects in-flight
  queries as typed errors (ADR-0024 / `neverthrow`) — a deliberate, classified failure
  (a transport-level 5xx) rather than a stray uncaught 500 with a stack trace —
  main respawns the worker, its resident stores rebuild lazily, and the state mirror
  emits the SSE transition. `serve` survives the OOM that 0042 had to flee to a process
  to contain.
- **Result transfer.** Results stay buffered to a string (as today) and cross the
  `MessagePort` via structured clone — one copy, the same copy buffering already pays.
  Streaming results over the port and out as a streamed HTTP response is a separable
  future optimization.
