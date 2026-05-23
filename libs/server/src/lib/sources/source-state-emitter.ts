import type { SourceTransition } from './source-state-event';

export type SourceStateListener = (transition: SourceTransition) => void;

export interface SourceStateEmitterOptions {
  onListenerError?: (error: unknown) => void;
}

/**
 * Synchronous fan-out of source-state transitions. A listener throw is isolated
 * and forwarded to `onListenerError`; remaining listeners still receive the event.
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

function noopListenerErrorHandler(_error: unknown): void {
  // intentionally empty
}
