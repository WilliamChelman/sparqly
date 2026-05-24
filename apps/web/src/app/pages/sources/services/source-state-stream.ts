import { InjectionToken } from '@angular/core';
import type { SourceRow } from '../models/source-row';

export interface SourceStateStreamHandlers {
  onRow: (row: SourceRow) => void;
  onRefetchSnapshot: () => void;
  onError?: (error: unknown) => void;
}

export interface SourceStateStream {
  /** Idempotent. */
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
