import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import type { ParameterDeclaration } from 'common';
import type {
  SavedQueriesService,
  SavedQueryWriteBody,
} from '@app/core';

/**
 * Per-side state and operations for an EditorFrame on the diff page.
 * One instance per editor side (left / right). Shares a single
 * SavedQueriesService and a library-refresh callback.
 */
export class EditorFrameController {
  readonly query: WritableSignal<string> = signal('');
  readonly loadedSlug = signal<string | null>(null);
  readonly loadedBody = signal<string | null>(null);
  readonly loadedEtag = signal<string | null>(null);
  readonly loadedParameters = signal<
    ReadonlyArray<ParameterDeclaration> | null
  >(null);
  readonly loadError = signal<{ kind: 'not-found'; slug: string } | null>(null);
  readonly saveAsOpen = signal<boolean>(false);
  readonly saveAsSlug = signal<string>('');
  readonly saveAsError = signal<string | null>(null);
  readonly staleConflict = signal<string | null>(null);

  constructor(
    private readonly svc: Pick<
      SavedQueriesService,
      'get' | 'put' | 'delete'
    >,
    private readonly onLibraryChanged: () => void,
  ) {}

  load(slug: string): void {
    this.svc.get(slug).subscribe({
      next: (loaded) => {
        this.loadError.set(null);
        this.query.set(loaded.entry.body);
        this.loadedSlug.set(loaded.entry.slug);
        this.loadedBody.set(loaded.entry.body);
        this.loadedEtag.set(loaded.etag);
        this.loadedParameters.set(loaded.entry.parameters ?? null);
      },
      error: (err: HttpErrorResponse) => {
        if (err?.status === 404) {
          this.loadError.set({ kind: 'not-found', slug });
        }
      },
    });
  }

  save(): void {
    const slug = this.loadedSlug();
    const etag = this.loadedEtag();
    if (slug === null || etag === null) return;
    this.svc.put(slug, this.buildWriteBody(), etag).subscribe((result) => {
      if (result.kind === 'saved') {
        this.loadedBody.set(this.query());
        this.loadedEtag.set(result.etag);
        this.onLibraryChanged();
      } else if (result.kind === 'stale') {
        this.staleConflict.set(slug);
      }
    });
  }

  staleReload(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.svc.get(slug).subscribe((loaded) => {
      this.query.set(loaded.entry.body);
      this.loadedSlug.set(loaded.entry.slug);
      this.loadedBody.set(loaded.entry.body);
      this.loadedEtag.set(loaded.etag);
      this.loadedParameters.set(loaded.entry.parameters ?? null);
      this.staleConflict.set(null);
    });
  }

  staleOverwrite(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.svc.get(slug).subscribe((loaded) => {
      this.svc
        .put(slug, this.buildWriteBody(), loaded.etag)
        .subscribe((result) => {
          if (result.kind === 'saved') {
            this.loadedSlug.set(slug);
            this.loadedBody.set(this.query());
            this.loadedEtag.set(result.etag);
            this.staleConflict.set(null);
            this.onLibraryChanged();
          }
        });
    });
  }

  openSaveAs(): void {
    this.saveAsSlug.set('');
    this.saveAsError.set(null);
    this.saveAsOpen.set(true);
  }

  setSaveAsSlug(slug: string): void {
    this.saveAsSlug.set(slug);
    this.saveAsError.set(null);
  }

  submitSaveAs(): void {
    const slug = this.saveAsSlug().trim();
    if (slug === '') return;
    this.svc.put(slug, this.buildWriteBody()).subscribe((result) => {
      if (result.kind === 'saved') {
        this.loadedSlug.set(slug);
        this.loadedBody.set(this.query());
        this.loadedEtag.set(result.etag);
        this.saveAsOpen.set(false);
        this.onLibraryChanged();
      } else if (result.kind === 'slug-exists') {
        this.saveAsError.set(`A query with slug "${slug}" already exists.`);
      }
    });
  }

  closeSaveAs(): void {
    this.saveAsOpen.set(false);
    this.saveAsError.set(null);
  }

  delete(): void {
    const slug = this.loadedSlug();
    const etag = this.loadedEtag();
    if (slug === null || etag === null) return;
    this.svc.delete(slug, etag).subscribe((result) => {
      if (result.kind === 'deleted') {
        this.clearLoaded();
        this.onLibraryChanged();
      }
    });
  }

  clearIfMatches(slug: string): void {
    if (this.loadedSlug() === slug) this.clearLoaded();
  }

  private clearLoaded(): void {
    this.loadedSlug.set(null);
    this.loadedBody.set(null);
    this.loadedEtag.set(null);
    this.loadedParameters.set(null);
  }

  private buildWriteBody(): SavedQueryWriteBody {
    const params = this.loadedParameters();
    return {
      body: this.query(),
      ...(params && params.length > 0 ? { parameters: params } : {}),
    };
  }
}
