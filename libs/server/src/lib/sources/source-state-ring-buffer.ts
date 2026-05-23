import type { SourceTransitionEvent } from './source-state-event';

/**
 * Bounded, monotonic-id ring buffer of recent **Source load state**
 * transitions (ADR-0044, #354). Backs the SSE stream's `Last-Event-ID`
 * replay path: on reconnect, the server replays events from this buffer
 * before resuming live delivery; reconnects whose `Last-Event-ID` is older
 * than the buffer's horizon get the refetch-snapshot sentinel back from
 * {@link since} so the client knows to re-fetch `GET /api/sources`.
 *
 * Pure data structure — no I/O, no timing, no transport coupling. Lifetime
 * is process-bound: a `serve` restart drops the buffer, and clients
 * reconnecting after a restart fall back to a snapshot fetch. This is the
 * right trade-off for state whose meaning is itself process-lifetime-bound.
 */
/**
 * Outcome of {@link SourceStateRingBuffer.since}. `events` carries the
 * playable suffix; `overflow` tells the caller the requested `lastId` is
 * older than the buffer's horizon and the client must re-fetch the
 * snapshot (`GET /api/sources`) before resuming live delivery — ADR-0044's
 * unbridgeable-reconnect path.
 */
export type SinceResult =
  | { kind: 'events'; events: SourceTransitionEvent[] }
  | { kind: 'overflow' };

export interface SourceStateRingBufferOptions {
  /**
   * Maximum number of buffered events. On overflow, the oldest is evicted —
   * a reconnect whose `Last-Event-ID` falls in the evicted prefix gets the
   * overflow sentinel from {@link SourceStateRingBuffer.since}.
   */
  capacity?: number;
}

export class SourceStateRingBuffer {
  private nextId = 1;
  private readonly events: SourceTransitionEvent[] = [];
  private readonly capacity: number;

  /** Default ring capacity (ADR-0044 — 256 entries is enough for typical UI reconnects). */
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
   * Returns every buffered event with `id > lastId`. `lastId === 0` is the
   * conventional "give me everything" cursor — a fresh client with no
   * `Last-Event-ID` header is treated as if it had seen id 0, never as an
   * overflow. Returns `{ kind: 'overflow' }` when `lastId` falls below the
   * buffer's horizon: the gap includes evicted events and the only safe
   * recovery is a snapshot re-fetch (ADR-0044, parent #352).
   */
  since(lastId: number): SinceResult {
    if (this.events.length > 0) {
      const oldestId = this.events[0].id;
      // `lastId < oldestId - 1` means we've evicted at least one event the
      // client has not seen; a replay would silently drop transitions.
      if (lastId > 0 && lastId < oldestId - 1) {
        return { kind: 'overflow' };
      }
    }
    const events = this.events.filter((e) => e.id > lastId);
    return { kind: 'events', events };
  }

  /**
   * The most recent id assigned by {@link append}, or `0` if the buffer
   * has never seen an event. The Sources controller writes this back as
   * the SSE `id:` of the snapshot boundary so a client that subscribes
   * immediately after `GET /api/sources` can use it as its starting
   * `Last-Event-ID`.
   */
  latestId(): number {
    return this.nextId - 1;
  }
}
