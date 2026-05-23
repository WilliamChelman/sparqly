import type { SourceTransitionEvent } from './source-state-event';

/**
 * Bounded, monotonic-id ring buffer backing the SSE `Last-Event-ID` replay
 * path. Lifetime is process-bound: a restart drops the buffer and reconnecting
 * clients fall back to a snapshot fetch.
 */
/** `overflow` tells the caller to re-fetch `GET /api/sources` before resuming live. */
export type SinceResult =
  | { kind: 'events'; events: SourceTransitionEvent[] }
  | { kind: 'overflow' };

export interface SourceStateRingBufferOptions {
  capacity?: number;
}

export class SourceStateRingBuffer {
  private nextId = 1;
  private readonly events: SourceTransitionEvent[] = [];
  private readonly capacity: number;

  static readonly DEFAULT_CAPACITY = 256;

  constructor(options: SourceStateRingBufferOptions = {}) {
    this.capacity = options.capacity ?? SourceStateRingBuffer.DEFAULT_CAPACITY;
    if (this.capacity < 1) {
      throw new Error(
        `SourceStateRingBuffer: capacity must be >= 1 (got ${this.capacity})`,
      );
    }
  }

  append(input: Omit<SourceTransitionEvent, 'id'>): SourceTransitionEvent {
    const event: SourceTransitionEvent = { id: this.nextId++, ...input };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.shift();
    return event;
  }

  /**
   * Returns events with `id > lastId`. `lastId === 0` is the "give me
   * everything" cursor (never an overflow). Returns `overflow` when `lastId`
   * falls below the buffer's horizon — a replay would silently drop transitions.
   */
  since(lastId: number): SinceResult {
    if (this.events.length > 0) {
      const oldestId = this.events[0].id;
      if (lastId > 0 && lastId < oldestId - 1) {
        return { kind: 'overflow' };
      }
    }
    const events = this.events.filter((e) => e.id > lastId);
    return { kind: 'events', events };
  }

  /** Most recent id assigned by {@link append}, or `0` if never appended. */
  latestId(): number {
    return this.nextId - 1;
  }
}
