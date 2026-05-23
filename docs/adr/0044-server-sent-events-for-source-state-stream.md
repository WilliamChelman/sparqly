---
status: accepted
---

# Server-Sent Events for the Sources page state stream

## Context

The new **Sources page** (CONTEXT.md) renders the **Source load state** of
every **served registry** entry — a state that changes over time: an in-memory
source touched from another tab transitions `not-loaded → loading → loaded`;
a disk-backed glob whose build child completes transitions
`indexing → ready`; an operator-issued **Reload** flips the entry's
`loadedAt` and `quads`. The page is the first webapp surface that needs to
*watch* server state, not just *query* it on demand.

`libs/server` has no event-stream infrastructure today — every route is a
plain REST endpoint. The polling-vs-push choice has to be made up front
because it shapes both the wire contract and the `EngineMap`-side wiring.

## Decision

- **The page subscribes via Server-Sent Events** on a new endpoint
  `GET /api/sources/stream`. Each event carries a full per-entry row
  payload (idempotent — the page replaces by id) and a monotonic SSE
  `id:` field.
- **A snapshot endpoint sits beside the stream.** `GET /api/sources`
  returns the canonical current state of every served entry, in the same
  per-row shape the stream emits. The page does
  *snapshot first, then subscribe*; non-page consumers (operator scripts,
  monitoring probes) can use the snapshot endpoint alone.
- **Reconnect uses native SSE replay.** `EngineMap` keeps a small in-memory
  ring buffer (256 entries) of recent transition events keyed by SSE id.
  On reconnect, the browser sends `Last-Event-ID` automatically; the
  server replays any events newer than that id before resuming live
  delivery. Beyond the ring buffer's horizon, the browser must re-fetch
  the snapshot — the page handles this by treating an unbridgeable
  reconnect as a full refresh.
- **The stream is read-only and public** with respect to **Source admin
  actions capability** (ADR-0045): viewing source state is not gated by
  `sources.allowAdminActions`. The gate applies only to mutating actions.

## Considered options

- **WebSockets.** Pushed back on during grilling. The protocol shape here
  is strictly `server → client`; the page sends all mutations through
  ordinary REST routes, never over the stream channel. WebSockets give
  a bidirectional channel we would not use, do not auto-reconnect (every
  WebSocket project ends up reinventing backoff/replay or pulling in
  `socket.io`), need a separate `@nestjs/websockets` module with adapter
  wiring, and require an HTTP `Upgrade` handshake some corporate proxies
  strip silently. SSE matches the shape, has core NestJS support
  (`@Sse()`), uses the standard browser `EventSource` with built-in
  reconnect, and rides plain HTTP.
- **Adaptive polling (default 10s, 1s while any entry is transient).**
  Lowest-infrastructure option. Rejected because we are willing to pay
  the SSE infrastructure cost once to get clean live UX, and because
  polling-while-transient still has up to 1s of lag on terminal
  transitions — annoying when watching a build finish.
- **`?since=<seq>` URL parameter for replay** instead of leaning on
  SSE's native `Last-Event-ID`. Rejected — the native header is what
  the browser already sends; reinventing it as a query param means
  ignoring a standard the protocol gives us for free.
- **One stream endpoint that emits a snapshot event on connect, then
  deltas.** Rejected — separating snapshot (`GET /api/sources`) from
  stream (`GET /api/sources/stream`) keeps each endpoint independently
  useful (curl, scripts, monitoring) and dodges the awkwardness of
  encoding "this is the initial snapshot" as a special event shape.

## Consequences

- First SSE in the codebase. NestJS's built-in `@Sse()` decorator is the
  intended primitive; no third-party event-stream dependency is taken.
- `EngineMap` (or a thin observer wrapper around it) gains an event
  emitter for state transitions: load start/success/failure, unload,
  build start/success/failure/cancel. Today's `source-loaded` debug log
  becomes one of these events.
- A 256-event ring buffer is server-resident and not persisted. A
  `serve` restart drops it; clients reconnecting after a restart fall
  back to a fresh snapshot fetch. This is the right trade-off for state
  whose meaning is itself process-lifetime-bound.
- The snapshot and stream contracts are versioned by their JSON shape;
  future additive fields (e.g. live build progress percentage) can be
  added without a new endpoint.
