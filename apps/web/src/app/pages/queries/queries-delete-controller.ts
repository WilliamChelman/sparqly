import { signal } from '@angular/core';
import { Router } from '@angular/router';
import type { LoadedSavedQuery, SavedQueriesService } from '@app/core';
import type { DetailState } from './queries-detail-state';

export interface DeleteControllerDeps {
  readonly service: SavedQueriesService;
  readonly router: Router;
  readonly detail: { set(value: DetailState): void };
  readonly selectedSlug: { set(value: string | null): void };
  readonly applyLoaded: (loaded: LoadedSavedQuery) => void;
}

export class DeleteController {
  readonly staleConflict = signal<string | null>(null);

  constructor(private readonly deps: DeleteControllerDeps) {}

  start(slug: string, etag: string): void {
    if (!window.confirm(`Delete saved query "${slug}"?`)) return;
    this.deps.service.delete(slug, etag).subscribe((result) => {
      if (result.kind === 'deleted') this.afterDeleted();
      else if (result.kind === 'stale') this.staleConflict.set(slug);
    });
  }

  reload(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.deps.service.get(slug).subscribe((loaded) => {
      this.staleConflict.set(null);
      this.deps.applyLoaded(loaded);
    });
  }

  confirmAfterStale(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.deps.service.get(slug).subscribe((loaded) => {
      this.deps.service.delete(slug, loaded.etag).subscribe((result) => {
        if (result.kind === 'deleted') this.afterDeleted();
      });
    });
  }

  private afterDeleted(): void {
    this.staleConflict.set(null);
    this.deps.detail.set({ kind: 'empty' });
    this.deps.selectedSlug.set(null);
    void this.deps.router.navigate(['/queries']);
  }
}
