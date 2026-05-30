import { Subject, concat, from, of, type Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import type { ParsedSource } from 'core';
import type { EngineMap } from '../bootstrap/engine-map';
import {
  projectTopLevelRow,
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

export interface SourcesSseEnvelope {
  id?: string;
  type?: string;
  data: SourceRow | { sentinel: 'refetch-snapshot' } | Record<string, never>;
}

/**
 * Bridges `EngineMap`'s `SourceStateEmitter` into the Sources page SSE stream:
 * reads state, projects the row, appends to the ring buffer, multicasts.
 * Ordering is preserved across rapid emits via a single async tail promise —
 * `readState` is async for disk-backed entries, so without serialization
 * transitions on different sources could append out of source-event order.
 */
export class SourceStateBroker {
  private readonly ringBuffer: SourceStateRingBuffer;
  private readonly live$ = new Subject<SourceTransitionEvent>();
  private readonly closed$ = new Subject<void>();
  private readonly unsubscribeEmitter: () => void;
  private readonly sourcesById: Map<string, ParsedSource>;
  /** Split-glob meta id → its synthesized File-source children. */
  private readonly childrenByParent: Map<string, ParsedSource[]>;
  /** Split-glob child id → its meta id, so a child transition refreshes the
   * parent's (children-folding) meta row rather than emitting an orphan row. */
  private readonly parentOf: Map<string, string>;
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
    this.childrenByParent = new Map();
    this.parentOf = new Map();
    for (const source of servedRegistry) {
      if (source.kind === 'reference') continue;
      if (source.id === undefined) continue;
      this.sourcesById.set(source.id, source);
      if (source.kind === 'file' && source.parentId !== undefined) {
        const siblings = this.childrenByParent.get(source.parentId) ?? [];
        siblings.push(source);
        this.childrenByParent.set(source.parentId, siblings);
        this.parentOf.set(source.id, source.parentId);
      }
    }
    this.unsubscribeEmitter = emitter.subscribe((transition) =>
      this.enqueue(transition),
    );
  }

  getHeartbeatMs(): number {
    return this.heartbeatMs;
  }

  /**
   * Build the live-stream observable for one subscriber. With `lastEventId`,
   * starts with the buffered replay (or a single `refetch-snapshot` sentinel
   * if the gap exceeds the ring's horizon), then continues live.
   */
  subscribe(lastEventId: number | undefined): Observable<SourcesSseEnvelope> {
    const replay$ = this.buildReplay(lastEventId);
    const live$ = this.live$.pipe(map((e) => this.toEnvelope(e)));
    return concat(replay$, live$);
  }

  close(): void {
    this.unsubscribeEmitter();
    this.live$.complete();
    this.closed$.next();
    this.closed$.complete();
  }

  /** Fires once when the broker is closed — lets SSE handlers tear down side-streams (e.g. heartbeat intervals) that wouldn't otherwise complete. */
  closing(): Observable<void> {
    return this.closed$.pipe(take(1));
  }

  latestId(): number {
    return this.ringBuffer.latestId();
  }

  /** Drains the projection queue — used by tests instead of `setTimeout`. */
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
    // A split-glob child is disclosed nested under its meta, never as its own
    // top-level row — so a child transition refreshes the parent meta. Route to
    // the parent (or self for a non-child) so the live row is projected exactly
    // as the snapshot would project it, children folded in.
    const topLevelId =
      this.parentOf.get(transition.sourceId) ?? transition.sourceId;
    const source = this.sourcesById.get(topLevelId);
    if (source === undefined) return; // reference / unknown — silently drop
    let row: SourceRow;
    try {
      row = await projectTopLevelRow(
        source,
        this.childrenByParent.get(topLevelId) ?? [],
        (id) => this.engineMap.readState(id),
      );
    } catch {
      // Skip — next snapshot fetch re-baselines the client.
      return;
    }
    const event = this.ringBuffer.append({ sourceId: topLevelId, row });
    this.live$.next(event);
  }

  private toEnvelope(event: SourceTransitionEvent): SourcesSseEnvelope {
    return { id: String(event.id), data: event.row };
  }
}
