import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import type { ParameterDeclaration } from 'common';
import type { SavedQueriesService } from '@app/core';

/**
 * Per-side run-surface state for an EditorFrame on the diff page (ADR-0038).
 * Carries query body + loaded parameters + load error. Authoring (Save / Save-as
 * / Delete / stale / modified-from) lives on `/queries` and is not part of the
 * diff run surface.
 */
export class EditorFrameController {
  readonly query: WritableSignal<string> = signal('');
  readonly loadedSlug = signal<string | null>(null);
  readonly loadedBody = signal<string | null>(null);
  readonly loadedParameters = signal<
    ReadonlyArray<ParameterDeclaration> | null
  >(null);
  readonly loadError = signal<{ kind: 'not-found'; slug: string } | null>(null);

  constructor(private readonly svc: Pick<SavedQueriesService, 'get'>) {}

  /**
   * Atomically swap this controller's per-side state with another's so callers
   * can flip /diff's left and right panes without re-fetching saved bodies.
   */
  static swap(a: EditorFrameController, b: EditorFrameController): void {
    const snapshot = {
      query: a.query(),
      loadedSlug: a.loadedSlug(),
      loadedBody: a.loadedBody(),
      loadedParameters: a.loadedParameters(),
      loadError: a.loadError(),
    };
    a.query.set(b.query());
    a.loadedSlug.set(b.loadedSlug());
    a.loadedBody.set(b.loadedBody());
    a.loadedParameters.set(b.loadedParameters());
    a.loadError.set(b.loadError());
    b.query.set(snapshot.query);
    b.loadedSlug.set(snapshot.loadedSlug);
    b.loadedBody.set(snapshot.loadedBody);
    b.loadedParameters.set(snapshot.loadedParameters);
    b.loadError.set(snapshot.loadError);
  }

  load(slug: string): void {
    this.svc.get(slug).subscribe({
      next: (loaded) => {
        this.loadError.set(null);
        this.query.set(loaded.entry.body);
        this.loadedSlug.set(loaded.entry.slug);
        this.loadedBody.set(loaded.entry.body);
        this.loadedParameters.set(loaded.entry.parameters ?? null);
      },
      error: (err: HttpErrorResponse) => {
        if (err?.status === 404) {
          this.loadError.set({ kind: 'not-found', slug });
        }
      },
    });
  }
}
