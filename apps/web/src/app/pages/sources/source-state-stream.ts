import { InjectionToken } from '@angular/core';
import type { SourceRow } from './sources.page';

/**
 * Subscriber-side abstraction over `GET /api/sources/stream` (ADR-0044,
 * #354). The page passes a {@link SourceStateStreamHandlers} bundle; the
 * factory returns a closeable {@link SourceStateStream} bound to those
 * handlers. The default implementation wraps the browser-native
 * `EventSource`; tests inject a fake factory so they can drive `row` and
 * `refetch-snapshot` events deterministically.
 *
 * The interface stays narrow on purpose — id tracking, reconnect cadence,
 * and `Last-Event-ID` are properties of the transport (`EventSource`
 * handles them automatically) and of the wire protocol (the broker writes
 * the sentinel envelope on unbridgeable reconnects). The page only needs
 * to know "here is a new row" or "drop everything and refetch".
 */
export interface SourceStateStreamHandlers {
  /** A row was emitted on the live stream — replace the matching id. */
  onRow: (row: SourceRow) => void;
  /**
   * The server signalled a `refetch-snapshot` sentinel (ADR-0044's
   * unbridgeable-reconnect path). The page must re-fetch `GET /api/sources`
   * and re-subscribe.
   */
  onRefetchSnapshot: () => void;
  /** Optional — fires on transport-level errors. */
  onError?: (error: unknown) => void;
}

export interface SourceStateStream {
  /** Idempotent — safe to call from `ngOnDestroy`. */
  close: () => void;
}

export interface SourceStateStreamFactory {
  open: (handlers: SourceStateStreamHandlers) => SourceStateStream;
}

export const SOURCE_STATE_STREAM_FACTORY =
  new InjectionToken<SourceStateStreamFactory>('SOURCE_STATE_STREAM_FACTORY', {
    providedIn: 'root',
    factory: () => new EventSourceSourceStateStreamFactory(),
  });

/**
 * Browser-native `EventSource` implementation. Default-message frames
 * (`event:` absent) are projected `SourceRow`s; the `refetch-snapshot`
 * named event is the unbridgeable-reconnect sentinel.
 */
export class EventSourceSourceStateStreamFactory
  implements SourceStateStreamFactory
{
  open(handlers: SourceStateStreamHandlers): SourceStateStream {
    const es = new EventSource('/api/sources/stream');
    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const row = JSON.parse(event.data) as SourceRow;
        handlers.onRow(row);
      } catch (error) {
        handlers.onError?.(error);
      }
    };
    es.addEventListener('refetch-snapshot', () => {
      handlers.onRefetchSnapshot();
    });
    es.onerror = (event) => handlers.onError?.(event);
    return {
      close: () => es.close(),
    };
  }
}
