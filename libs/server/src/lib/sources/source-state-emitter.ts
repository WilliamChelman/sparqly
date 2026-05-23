import type { SourceTransition } from './source-state-event';

/**
 * Synchronous listener invoked once per emit. May throw — the emitter
 * isolates the throw from siblings and reports it through
 * {@link SourceStateEmitterOptions.onListenerError}, never lets it abort
 * delivery to other subscribers.
 */
export type SourceStateListener = (transition: SourceTransition) => void;

export interface SourceStateEmitterOptions {
  /**
   * Reported once per listener throw. Defaults to a no-op — the SSE
   * transport supplies a logger so the bug is visible without `vi.spyOn`.
   */
  onListenerError?: (error: unknown) => void;
}

/**
 * Observer wrapper around the **Source load state** transitions that
 * `EngineMap` emits — load start/success/failure, unload, build
 * start/success/failure/cancel (parent #352, ADR-0044). Decouples
 * `EngineMap` from any specific transport: today's only subscriber is the
 * SSE stream + ring buffer wiring, but a future webhook or in-process
 * audit log can subscribe without `EngineMap` learning about the new path.
 *
 * Synchronous semantics: subscribers run inline on `emit`, in
 * subscription order. A thrown error in one listener is isolated and
 * forwarded to {@link SourceStateEmitterOptions.onListenerError}; the
 * remaining listeners still receive the event. This is the "one
 * subscriber's exception does not break delivery to others" contract from
 * #354.
 */
export class SourceStateEmitter {
  private readonly listeners: Set<SourceStateListener> = new Set();
  private readonly onListenerError: (error: unknown) => void;

  constructor(options: SourceStateEmitterOptions = {}) {
    this.onListenerError =
      options.onListenerError ?? noopListenerErrorHandler;
  }

  subscribe(listener: SourceStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(transition: SourceTransition): void {
    for (const listener of this.listeners) {
      try {
        listener(transition);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}

/**
 * Default error sink — swallows listener exceptions so a misbehaving
 * subscriber can't break emit delivery to the rest. Pulled out of the
 * constructor to avoid the no-empty-function lint flag on the inline
 * fallback.
 */
function noopListenerErrorHandler(_error: unknown): void {
  // intentionally empty
}
