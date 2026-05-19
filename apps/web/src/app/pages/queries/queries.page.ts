import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import {
  ConfigService,
  SavedQueriesService,
  type LoadedSavedQuery,
  type SavedQuerySummary,
} from '@app/core';
import {
  QueriesCreateDetailComponent,
  type CreatePayload,
} from './queries-create-detail.component';
import {
  toWriteBody,
  type CreateNavState,
  type DetailState,
} from './queries-detail-state';
import {
  QueriesLoadedDetailComponent,
  type LoadedDetailInput,
} from './queries-loaded-detail.component';
import { QueriesRailComponent } from './queries-rail.component';

@Component({
  selector: 'app-queries-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    QueriesCreateDetailComponent,
    QueriesLoadedDetailComponent,
    QueriesRailComponent,
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">saved queries</h1>
      <p class="text-sm text-foreground-muted">
        Browse, edit, and save entries in the saved-query library.
      </p>
    </header>
    <main class="flex gap-4 p-4">
      <app-queries-rail
        [entries]="entries()"
        [selectedSlug]="selectedSlug()"
        [writable]="writable()"
        (selectEntry)="onSelect($event)"
        (newQuery)="onNew()"
      />
      <section class="flex-1" data-testid="queries-detail">
        @switch (detail().kind) {
          @case ('empty') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-empty"
            >
              Select an entry to view its body.
            </p>
          }
          @case ('loading') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-loading"
            >
              loading…
            </p>
          }
          @case ('not-found') {
            <p
              class="text-sm text-foreground-faint"
              data-testid="queries-detail-not-found"
            >
              No saved query with slug "{{ notFoundSlug() }}".
            </p>
          }
          @case ('create') {
            <app-queries-create-detail
              [prefillBody]="createPrefillBody()"
              [prefillParameters]="createPrefillParameters()"
              [errorSlug]="createErrorSlug()"
              (save)="onCreate($event)"
              (cancel)="onCancelCreate()"
            />
          }
          @case ('loaded') {
            @if (loadedInput(); as loaded) {
              <app-queries-loaded-detail
                [loaded]="loaded"
                [writable]="writable()"
                [sourceId]="sourceId()"
                (sourceChange)="onSourceChange($event)"
                (saved)="refreshLibrary()"
              />
            }
          }
        }
      </section>
    </main>
  `,
})
export class QueriesPage implements OnInit {
  private readonly service = inject(SavedQueriesService);
  private readonly configService = inject(ConfigService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly entries = signal<readonly SavedQuerySummary[]>([]);
  readonly selectedSlug = signal<string | null>(null);
  readonly detail = signal<DetailState>({ kind: 'empty' });
  readonly sourceId = signal<string>('');
  readonly createErrorSlug = signal<string | null>(null);
  readonly writable = signal<boolean>(true);

  readonly notFoundSlug = computed(() => {
    const d = this.detail();
    return d.kind === 'not-found' ? d.slug : '';
  });

  readonly createPrefillBody = computed(() => {
    const d = this.detail();
    return d.kind === 'create' ? d.prefillBody : '';
  });

  readonly createPrefillParameters = computed(() => {
    const d = this.detail();
    return d.kind === 'create' ? d.prefillParameters : [];
  });

  readonly loadedInput = computed<LoadedDetailInput | null>(() => {
    const d = this.detail();
    if (d.kind !== 'loaded') return null;
    return {
      slug: d.slug,
      body: d.loadedBody,
      etag: d.loadedEtag,
      parameters: d.loadedParameters,
    };
  });

  ngOnInit(): void {
    const source = this.route.snapshot.queryParamMap.get('source');
    if (source) this.sourceId.set(source);
    this.configService.savedQueries().subscribe((c) => {
      this.writable.set(c.writable);
      if (this.route.snapshot.data['mode'] === 'create' && !c.writable) {
        void this.router.navigate(['/queries'], { replaceUrl: true });
      }
    });
    let firstEmission = true;
    combineLatest([this.route.paramMap, this.route.data])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, data]) => {
        const isFirst = firstEmission;
        firstEmission = false;
        const mode = data['mode'];
        const slug = params.get('slug');
        if (mode === 'create') {
          this.enterCreate();
          if (isFirst) this.refreshLibrary();
          return;
        }
        const applySlug = () => {
          if (slug !== null) {
            this.loadSlug(slug);
          } else {
            this.selectedSlug.set(null);
            this.detail.set({ kind: 'empty' });
          }
        };
        if (isFirst) this.refreshLibrary(applySlug);
        else applySlug();
      });
  }

  private enterCreate(): void {
    const nav = this.router.lastSuccessfulNavigation()?.extras.state as
      | CreateNavState
      | undefined;
    this.selectedSlug.set(null);
    this.createErrorSlug.set(null);
    this.detail.set({
      kind: 'create',
      origin: nav?.origin ?? null,
      prefillBody: nav?.prefill?.body ?? '',
      prefillParameters: nav?.prefill?.parameters ?? [],
    });
  }

  onSourceChange(id: string): void {
    if (id === this.sourceId()) return;
    this.sourceId.set(id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { source: id || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onSelect(slug: string): void {
    void this.router.navigate(['/queries', slug], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
    });
  }

  onNew(): void {
    void this.router.navigate(['/queries', 'new']);
  }

  onCancelCreate(): void {
    const d = this.detail();
    const origin = d.kind === 'create' ? d.origin : null;
    void this.router.navigate(origin ? ['/queries', origin] : ['/queries']);
  }

  onCreate(payload: CreatePayload): void {
    const writeBody = toWriteBody(payload.body, payload.parameters);
    this.service.put(payload.slug, writeBody).subscribe((result) => {
      if (result.kind === 'saved') {
        void this.router.navigate(['/queries', payload.slug]);
      } else if (result.kind === 'slug-exists') {
        this.createErrorSlug.set(payload.slug);
      }
    });
  }

  refreshLibrary(after?: () => void): void {
    this.service.list().subscribe((entries) => {
      this.entries.set(entries);
      if (after) after();
    });
  }

  private loadSlug(slug: string): void {
    this.selectedSlug.set(slug);
    const known = this.entries().some((e) => e.slug === slug);
    if (!known) {
      this.detail.set({ kind: 'not-found', slug });
      return;
    }
    if (this.detail().kind !== 'loaded') {
      this.detail.set({ kind: 'loading', slug });
    }
    this.service.get(slug).subscribe({
      next: (loaded) => {
        if (this.selectedSlug() !== slug) return;
        this.applyLoaded(loaded);
      },
      error: () => {
        if (this.selectedSlug() !== slug) return;
        this.detail.set({ kind: 'not-found', slug });
      },
    });
  }

  private applyLoaded(loaded: LoadedSavedQuery): void {
    const parameters = loaded.entry.parameters ?? [];
    this.detail.set({
      kind: 'loaded',
      slug: loaded.entry.slug,
      loadedBody: loaded.entry.body,
      loadedEtag: loaded.etag,
      loadedParameters: parameters,
    });
  }
}
