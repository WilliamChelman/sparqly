import type { SourceRow } from './source-row-projector';

export type SourceTransitionKind =
  | 'load-start'
  | 'load-success'
  | 'load-failure'
  | 'unload'
  | 'build-start'
  | 'build-success'
  | 'build-failure'
  | 'build-cancel'
  | 'stale-detected';

/** Raw transition record emitted by `EngineMap`. The id and projected row are
 * assigned downstream (controller projects, ring buffer assigns id). */
export interface SourceTransition {
  kind: SourceTransitionKind;
  sourceId: string;
}

/** Wire event carrying the full projected row — client replaces by id, no diff. */
export interface SourceTransitionEvent {
  /** Monotonic id assigned by the ring buffer; starts at 1. */
  id: number;
  sourceId: string;
  row: SourceRow;
}
