import type { SourceRow } from './source-row-projector';

/**
 * The kind of **Source load state** transition observed by `EngineMap` —
 * the surface the parent epic (#352, ADR-0044) documents. Subscribers may
 * branch on `kind` if they care about *which* edge of the state machine
 * was crossed (e.g. a logger logging only the terminal outcomes); the SSE
 * stream itself ignores `kind` and just re-projects the row on each emit
 * (idempotent-row contract).
 */
export type SourceTransitionKind =
  | 'load-start'
  | 'load-success'
  | 'load-failure'
  | 'unload'
  | 'build-start'
  | 'build-success'
  | 'build-failure'
  | 'build-cancel'
  /**
   * `readState` observed a disk-backed **Glob index** whose freshly-recomputed
   * manifest no longer matches the on-disk one (#357). Emitted once per
   * distinct `staleReason` so a live Sources page learns about the drift
   * without waiting for the next snapshot fetch; sparqly never silently
   * rebuilds — the user clears `stale` with a manual rebuild (ADR-0043).
   */
  | 'stale-detected';

/**
 * Raw transition record emitted by `EngineMap` into the
 * {@link SourceStateEmitter}. The emitter carries no monotonic id and no
 * projected payload — those are concerns of the SSE wiring downstream
 * (controller does the projection; ring buffer assigns the id on append).
 */
export interface SourceTransition {
  kind: SourceTransitionKind;
  sourceId: string;
}

/**
 * The wire-format event the **Sources page**'s SSE stream emits (ADR-0044,
 * #354). Carries the full projected {@link SourceRow} so the client can
 * blindly replace the matching row by id — no diff, no delta merging.
 * `id` is the monotonic identifier {@link SourceStateRingBuffer.append}
 * assigns; it is also what the SSE transport writes as `id:` and what the
 * browser sends back on reconnect via `Last-Event-ID`.
 */
export interface SourceTransitionEvent {
  /** Monotonic id, assigned by the ring buffer on append. Starts at 1. */
  id: number;
  /** The `@id` of the registry entry the transition belongs to. */
  sourceId: string;
  /** Full row payload — same shape as `GET /api/sources` returns. */
  row: SourceRow;
}
