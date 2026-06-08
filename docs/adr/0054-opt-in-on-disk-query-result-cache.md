# Opt-in on-disk query-result cache (`queryCache`)

We add a **Query cache**: an opt-in, on-disk store of serialized **inline query** results that sits above all three resolution paths (materialized, pass-through endpoint, disk-backed glob), so a repeated `query` against the same **target source** is answered without re-running resolution. It is enabled per source via `queryCache: true | { ttl, maxBytes }`, active only when at least one source opts in, with an optional top-level `queryCache:` block for the global `maxBytes` budget and the default `ttl`. It holds *answers*, distinct from the **Glob index** and the resident-set store budget (`query.maxResidentQuads`), which hold *data*.

## Context

Every query against an **Endpoint source** pays a remote round-trip, and every query against a **Disk-backed glob** pays a LevelDB traversal — neither is cached today. The resident set already caches loaded in-memory Stores under `serve`, but nothing caches *results*, and nothing helps the one-shot CLI across invocations. Caching results is the horizontal layer that helps every source kind uniformly.

## Decision

- **Unit:** serialized result bodies, keyed on `(source id, freshness token, verbatim query, output format, context digest)` plus a cache-schema version.
- **Freshness contract is path-aware:** local sources (materialized glob/file, disk-backed) fold a content fingerprint into the key — a `(path, mtime, size)` stat-digest for in-memory globs, the existing manifest digest for disk-backed, the resolved SHA for a **Pinned source** — so an underlying change is a different key (a miss), not a stale hit. An **Endpoint source** is opaque, so an absolute TTL (from insertion) is its only staleness bound.
- **Storage:** `better-sqlite3` in WAL mode, a single file under `<configDir>/.sparqly/cache/`. Persistent across CLI invocations and `serve` restarts.
- **Eviction:** absolute TTL + byte-budget LRU, enforced by a lazy inline sweep (on-read TTL self-heal; on-write expiry purge + LRU evict-to-budget). Global pool by default, optional per-source `maxBytes` cap. Default `ttl: 1h`, `maxBytes: 256 MB`, `maxEntryBytes: 32 MB`. An explicitly unbounded budget is allowed but warns on cache open.
- **Refusals:** non-deterministic queries (`NOW`/`RAND`/`UUID`, detected by a conservative token scan) bypass the cache; errors are never cached; empty results are cached; results over `maxEntryBytes` bypass.
- **Controls:** `--no-cache` and `--refresh`; `sparqly cache clear` / `cache stats`; a per-request refresh and an `X-Sparqly-Cache: hit|miss|bypass` header under `serve`. Caching operates normally under `serve --read-only`; only `cache clear` is gated.
- **Version safety:** a cache-schema version is stamped in the store and checked on open; a mismatch wipes and rebuilds, so a sparqly upgrade that changes serialization can never serve a wrong cached body.

## Considered options

- **In-memory only.** Simplest and captures the dominant `serve` workload, but gives the one-shot CLI nothing across invocations — and cross-invocation CLI caching is a hard requirement. Rejected.
- **LevelDB (`classic-level`, as the Glob index uses).** Dependency-consistent, but LevelDB takes a process-exclusive lock; concurrent CLI runs (and a CLI run alongside `serve`) cannot share the store. Disqualifying for a cache hit on every query from many short-lived processes.
- **libSQL / Turso.** A SQLite fork built for distributed replication, remote network clients, and multi-writer `BEGIN CONCURRENT`. None apply to a per-project, single-machine, local cache whose writes are infrequent (misses only); `better-sqlite3` is faster, synchronous (suits the CLI), and operationally boring.
- **Plain files.** No dependency, but LRU needs a global recency ordering and total-size view, forcing either full-directory scans or a central index file that reintroduces the cross-process write contention SQLite handles natively.
- **Path-aware default TTL (endpoint short / local long).** More theoretically optimal, but a single predictable default was preferred. `1h` straddles the two pressures: long enough that repeated CLI runs hit within a work session, short enough that endpoint staleness stays defensible for an exploration tool; volatile endpoints override per source.

## Consequences

- A new native dependency (`better-sqlite3`) joins the existing native `classic-level`.
- Computing a materialized glob's freshness token means enumerating + `stat`-ing matched files on every lookup; accepted, because parse cost dwarfs stat cost for any glob large enough to matter, and pathological cases have the disk-backed path with a manifest.
- `describe` result caching (its own key shape), an in-memory hot tier, single-flight dogpile protection, a webapp "clear cache" affordance, and negative caching are explicitly out of the initial slice.
