# Boundary logging via an injected `SparqlyLogger`

We want observability at the process boundaries — HTTP requests hitting `serve`, SPARQL queries executed against sources (local stores, remote endpoints, view chains), and source loading / freshness probes — with timings. `libs/core` is framework-agnostic and must stay that way, so it cannot import the NestJS `Logger` the CLI and server use.

**Decision.** Define a minimal `SparqlyLogger` interface in `libs/common` (`debug | info | warn | error(msg: string, fields?: Record<string, unknown>)`) and inject it where boundary events originate, defaulting to a no-op so existing callers and tests are unaffected. `QueryEngine` takes an optional `meta` (`{ id, mode, logger }`) and emits the "query ran" event itself — timing + `logger.debug('query', { source, mode, type, ms, rows/quads, query: <truncated, single-lined> })` — so every entry point (`query`, `hash`, `diff`, `serve`, view chains) reports consistently from one place. The HTTP request line is emitted separately by a NestJS interceptor in `libs/server`. The CLI/server adapt their NestJS `Logger` to `SparqlyLogger`.

**Levels.** HTTP request lines are default-on (shown by `sparqly serve` with no flags). SPARQL-execution lines, source loading, view resolution, and freshness ASK probes are `debug` (opt-in via `--verbose`). `--quiet` silences everything. No granular `--log-level` flag — the existing `verbose`/`quiet` toggle stays.

**Format & destination.** All log output goes to stderr (stdout stays clean for piped query results). Lines carry a timestamp + level marker. A `--log-format json` flag emits one JSON object per line; default is human-readable text. Logging is *not* configurable via `sparqly.config.yaml` — verbosity is an invocation-time concern, not a project property.

**No correlation IDs.** `serve` is a local single-user dev/playground surface (see ADR-0011, ADR-0016); flat lines + timestamps are enough. If `serve` ever grows real concurrency, an `AsyncLocalStorage`-backed request id can be added behind the already-injected logger without touching `libs/core`'s API.

## Considered alternatives

- **Callback / EventEmitter on `QueryEngine`** instead of an injected logger — lighter, but loses log levels inside core and makes "logging" an indirect event-plumbing concern.
- **Module-level logger singleton in `libs/common`** — zero threading, but ambient global state, harder to test in isolation.
- **Callers wrap `execute()` for the query event** instead of `QueryEngine` emitting it — keeps the engine pure, but spreads the responsibility across 2–3 call sites that can drift.
