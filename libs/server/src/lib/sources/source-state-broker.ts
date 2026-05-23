import { Subject, concat, from, of, type Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ParsedSource } from 'core';
import type { EngineMap } from '../bootstrap/engine-map';
import {
  projectSourceRow,
  type SourceRow,
} from './source-row-projector';
import {
  SourceStateRingBuffer,
  type SinceResult,
} from './source-state-ring-buffer';
import type { SourceStateEmitter } from './source-state-emitter';
import type {
  SourceTransition,
  SourceTransitionEvent,
} from './source-state-event';

/**
 * The wire-format envelope `GET /api/sources/stream` writes per event
 * (ADR-0044, #354). Matches what NestJS `@Sse()` flattens into the SSE
 * frame: `id: …\nevent: …\ndata: …\n\n`. `data` is JSON-stringified by
 * Nest when non-string.
 */
export interface SourcesSseEnvelope {
  id?: string;
  type?: string;
  data: SourceRow | { sentinel: 'refetch-snapshot' } | Record<string, never>;
}

/**
 * Bridge between `EngineMap`'s {@link SourceStateEmitter} and the Sources
 * page SSE stream (ADR-0044, #354). One broker instance per server
 * lifetime. Subscribes to the emitter once and:
 *
 * 1. asks `EngineMap.readState(id)` for the current runtime,
 * 2. projects to the wire `SourceRow` (idempotent payload contract),
 * 3. appends to a {@link SourceStateRingBuffer} (assigns the monotonic id),
 * 4. multicasts to all live SSE subscribers.
 *
 * Ordering is preserved across rapid emits via a single async tail
 * promise — projection N starts only after projection N-1 has appended.
 * Without this, two transitions on different sources could append out of
 * source-event order because `readState` is async for disk-backed entries.
 *
 * The heartbeat cadence lives here but the heartbeat *emission* is the
 * controller's responsibility (it merges a `rxjs/interval` into the live
 * stream). That split lets the broker stay free of timing concerns and
 * keeps tests deterministic.
 */
export class SourceStateBroker {
  private readonly ringBuffer: SourceStateRingBuffer;
  private readonly live$ = new Subject<SourceTransitionEvent>();
  private readonly unsubscribeEmitter: () => void;
  private readonly sourcesById: Map<string, ParsedSource>;
  private readonly heartbeatMs: number;
  /** Tail of the serial projection queue — guarantees per-emit ordering. */
  private projectionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly engineMap: EngineMap,
    emitter: SourceStateEmitter,
    servedRegistry: ReadonlyArray<ParsedSource>,
    options: { capacity?: number; heartbeatMs?: number } = {},
  ) {
    this.ringBuffer = new SourceStateRingBuffer({ capacity: options.capacity });
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.sourcesById = new Map();
    for (const source of servedRegistry) {
      if (source.kind === 'reference') continue;
      if (source.id === undefined) continue;
      this.sourcesById.set(source.id, source);
    }
    this.unsubscribeEmitter = emitter.subscribe((transition) =>
      this.enqueue(transition),
    );
  }

  /** Heartbeat cadence in ms — read by the SSE route. */
  getHeartbeatMs(): number {
    return this.heartbeatMs;
  }

  /**
   * Build the live-stream observable for a single SSE subscriber. If
   * `lastEventId` is set, the observable starts with the buffered replay
   * (or a single `refetch-snapshot` sentinel envelope when the gap exceeds
   * the ring's horizon — the client then re-fetches `GET /api/sources`
   * per ADR-0044), then continues with live events.
   */
  subscribe(lastEventId: number | undefined): Observable<SourcesSseEnvelope> {
    const replay$ = this.buildReplay(lastEventId);
    const live$ = this.live$.pipe(map((e) => this.toEnvelope(e)));
    return concat(replay$, live$);
  }

  /** Releases the emitter subscription. Called when the server shuts down. */
  close(): void {
    this.unsubscribeEmitter();
    this.live$.complete();
  }

  /** The most recent id assigned to a buffered event, or 0 if none. */
  latestId(): number {
    return this.ringBuffer.latestId();
  }

  /**
   * Resolves once every emit observed up to the call has been projected,
   * appended, and multicast. Tests use this to drain the queue without
   * `setTimeout`. Production code never needs it.
   */
  whenIdle(): Promise<void> {
    return this.projectionTail;
  }

  private buildReplay(
    lastEventId: number | undefined,
  ): Observable<SourcesSseEnvelope> {
    if (lastEventId === undefined) return from([] as SourcesSseEnvelope[]);
    const result: SinceResult = this.ringBuffer.since(lastEventId);
    if (result.kind === 'overflow') {
      return of<SourcesSseEnvelope>({
        type: 'refetch-snapshot',
        data: { sentinel: 'refetch-snapshot' },
      });
    }
    return from(result.events.map((e) => this.toEnvelope(e)));
  }

  private enqueue(transition: SourceTransition): void {
    this.projectionTail = this.projectionTail.then(() =>
      this.project(transition),
    );
  }

  private async project(transition: SourceTransition): Promise<void> {
    const source = this.sourcesById.get(transition.sourceId);
    if (source === undefined) return; // reference / unknown — silently drop
    let row: SourceRow;
    try {
      const runtime = await this.engineMap.readState(transition.sourceId);
      row = projectSourceRow(source, runtime);
    } catch {
      // Projection failure on a transition is not fatal — skip this event;
      // the next snapshot fetch will re-baseline the client if needed.
      return;
    }
    const event = this.ringBuffer.append({
      sourceId: transition.sourceId,
      row,
    });
    this.live$.next(event);
  }

  private toEnvelope(event: SourceTransitionEvent): SourcesSseEnvelope {
    return { id: String(event.id), data: event.row };
  }
}
