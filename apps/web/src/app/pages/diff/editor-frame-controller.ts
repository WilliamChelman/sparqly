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
