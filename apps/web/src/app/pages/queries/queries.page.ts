import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConfigService,
  SavedQueriesService,
  type LoadedSavedQuery,
  type SavedQuerySummary,
  type SavedQueryWriteBody,
} from '@app/core';
import { ButtonComponent } from '@app/modules/button';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import {
  substitute,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';
import { ParameterEditorComponent } from '../query/components/parameter-editor.component';
import { ParameterFormComponent } from '../query/components/parameter-form.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from '../query/components/result/result-pane.component';
import {
  QueriesCreateDetailComponent,
  type CreatePayload,
} from './queries-create-detail.component';
import {
  parametersEqual,
  toWriteBody,
  type CreateNavState,
  type DetailState,
} from './queries-detail-state';
import { DeleteController } from './queries-delete-controller';
import { QueriesStaleDeleteDialogComponent } from './queries-stale-delete-dialog.component';
import { QueriesStaleDialogComponent } from './queries-stale-dialog.component';
import { runSparql } from './utils/run-sparql';

@Component({
  selector: 'app-queries-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    SourcesPickerComponent,
    ResultPaneComponent,
    ParameterFormComponent,
    YasqeEditorComponent,
    ParameterEditorComponent,
    QueriesCreateDetailComponent,
    QueriesStaleDialogComponent,
    QueriesStaleDeleteDialogComponent,
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">saved queries</h1>
      <p class="text-sm text-foreground-muted">
        Browse, edit, and save entries in the saved-query library.
      </p>
    </header>
    <main class="flex gap-4 p-4">
      <aside
        class="flex w-64 shrink-0 flex-col gap-2 border-r border-border-muted pr-4"
        data-testid="queries-rail"
      >
        <input
          type="text"
          data-testid="queries-filter"
          placeholder="filter by slug…"
          [value]="filter()"
          (input)="onFilter($event)"
          class="rounded border border-border bg-surface px-2 py-1 text-sm text-foreground"
        />
        @if (writable()) {
          <button
            app-btn
            type="button"
            variant="secondary"
            size="sm"
            data-testid="queries-new"
            (click)="onNew()"
          >
            + New
          </button>
        }
        <ul class="flex flex-col gap-1">
          @for (entry of visibleEntries(); track entry.slug) {
            <li>
              <button
                app-btn
                variant="ghost"
                size="sm"
                type="button"
                data-testid="queries-entry"
                [attr.data-slug]="entry.slug"
                [attr.aria-current]="
                  entry.slug === selectedSlug() ? 'true' : null
                "
                (click)="onSelect(entry.slug)"
                class="w-full justify-start truncate text-foreground-muted hover:text-foreground aria-[current=true]:text-foreground"
              >
                {{ entry.slug }}
              </button>
            </li>
          }
        </ul>
      </aside>
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
            <div class="flex items-center justify-between">
              <h2
                class="font-mono text-sm text-foreground"
                data-testid="queries-detail-slug"
              >
                {{ loadedSlug() }}
              </h2>
              @if (isModifiedFromLoaded()) {
                <span
                  data-testid="queries-modified-badge"
                  class="font-mono text-xs text-warning"
                >
                  modified from <code>{{ loadedSlug() }}</code>
                </span>
              }
            </div>
            @if (writable()) {
              <app-yasqe-editor
                class="mt-2 block"
                [value]="draftBody()"
                (valueChange)="onBodyChange($event)"
              />
            } @else {
              <pre
                data-testid="queries-body-readonly"
                class="mt-2 block overflow-auto rounded border border-border-muted bg-surface p-2 font-mono text-sm text-foreground"
              >{{ draftBody() }}</pre>
            }
            @if (writable()) {
              <div class="mt-3">
                <app-parameter-editor
                  [parameters]="draftParameters()"
                  [body]="draftBody()"
                  (parametersChange)="onParametersDraftChange($event)"
                />
              </div>
            }
            <div class="mt-3 flex flex-col gap-3">
              <app-sources-picker
                label="source"
                [value]="sourceId()"
                (valueChange)="onSourceChange($event)"
              />
              <div class="flex gap-2">
                @if (writable()) {
                  <button
                    type="button"
                    data-testid="queries-save"
                    (click)="onSave()"
                    class="inline-flex items-center rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm"
                  >
                    Save
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="queries-save-as"
                    (click)="onSaveAs()"
                  >
                    Save as…
                  </button>
                  <button
                    app-btn
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="queries-delete"
                    (click)="onDelete()"
                  >
                    Delete
                  </button>
                }
                <button
                  type="button"
                  data-testid="queries-run"
                  [disabled]="!sourceId()"
                  (click)="onRun()"
                  class="inline-flex items-center rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Run
                </button>
              </div>
              @if (staleConflict(); as slug) {
                <app-queries-stale-dialog
                  [slug]="slug"
                  (reload)="onStaleReload()"
                  (overwrite)="onStaleOverwrite()"
                />
              }
              @if (deleteController.staleConflict(); as slug) {
                <app-queries-stale-delete-dialog
                  [slug]="slug"
                  (reload)="deleteController.reload()"
                  (confirmDelete)="deleteController.confirmAfterStale()"
                />
              }
              @if (hasDraftParameters()) {
                <app-parameter-form
                  [parameters]="draftParameters()"
                  (submitBindings)="onSubmitBindings($event)"
                />
              }
              <app-result-pane [state]="resultState()" />
            </div>
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
  private readonly http = inject(HttpClient);

  readonly entries = signal<readonly SavedQuerySummary[]>([]);
  readonly filter = signal<string>('');
  readonly selectedSlug = signal<string | null>(null);
  readonly detail = signal<DetailState>({ kind: 'empty' });
  readonly sourceId = signal<string>('');
  readonly resultState = signal<ResultPaneState>({ kind: 'empty' });
  readonly draftBody = signal<string>('');
  readonly draftParameters = signal<ReadonlyArray<ParameterDeclaration>>([]);
  readonly staleConflict = signal<string | null>(null);
  readonly deleteController = new DeleteController({
    service: this.service,
    router: this.router,
    detail: this.detail,
    selectedSlug: this.selectedSlug,
    applyLoaded: (loaded) => this.applyLoaded(loaded),
  });
  readonly createErrorSlug = signal<string | null>(null);
  readonly writable = signal<boolean>(true);

  readonly visibleEntries = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const sorted = [...this.entries()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    if (needle === '') return sorted;
    return sorted.filter((e) => e.slug.toLowerCase().includes(needle));
  });

  readonly loadedSlug = computed(() => {
    const d = this.detail();
    return d.kind === 'loaded' ? d.slug : '';
  });

  readonly notFoundSlug = computed(() => {
    const d = this.detail();
    return d.kind === 'not-found' ? d.slug : '';
  });

  readonly hasDraftParameters = computed(
    () => this.draftParameters().length > 0,
  );

  readonly createPrefillBody = computed(() => {
    const d = this.detail();
    return d.kind === 'create' ? d.prefillBody : '';
  });

  readonly createPrefillParameters = computed(() => {
    const d = this.detail();
    return d.kind === 'create' ? d.prefillParameters : [];
  });

  readonly isModifiedFromLoaded = computed(() => {
    const d = this.detail();
    if (d.kind !== 'loaded') return false;
    if (this.draftBody() !== d.loadedBody) return true;
    return !parametersEqual(this.draftParameters(), d.loadedParameters);
  });

  ngOnInit(): void {
    const mode = this.route.snapshot.data['mode'];
    const slug = this.route.snapshot.paramMap.get('slug');
    const source = this.route.snapshot.queryParamMap.get('source');
    if (source) this.sourceId.set(source);
    this.configService.savedQueries().subscribe((c) => {
      this.writable.set(c.writable);
      if (mode === 'create' && !c.writable) {
        void this.router.navigate(['/queries'], { replaceUrl: true });
      }
    });
    if (mode === 'create') this.enterCreate();
    this.refreshLibrary(() => {
      if (mode !== 'create' && slug !== null) this.loadSlug(slug);
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

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  onSourceChange(id: string): void {
    if (id === this.sourceId()) return;
    this.sourceId.set(id);
    this.resultState.set({ kind: 'empty' });
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

  onSaveAs(): void {
    const d = this.detail();
    if (d.kind !== 'loaded') return;
    void this.router.navigate(['/queries', 'new'], {
      state: {
        prefill: {
          body: this.draftBody(),
          parameters: this.draftParameters(),
        },
        origin: d.slug,
      },
    });
  }

  onBodyChange(value: string): void {
    this.draftBody.set(value);
  }

  onParametersDraftChange(
    parameters: ReadonlyArray<ParameterDeclaration>,
  ): void {
    this.draftParameters.set(parameters);
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

  onSave(): void {
    const d = this.detail();
    if (d.kind !== 'loaded') return;
    const slug = d.slug;
    const writeBody = this.buildWriteBody();
    this.service.put(slug, writeBody, d.loadedEtag).subscribe((result) => {
      if (result.kind === 'saved') {
        this.setLoadedAfterSave(slug, writeBody, result.etag);
      } else if (result.kind === 'stale') {
        this.staleConflict.set(slug);
      }
    });
  }

  onStaleReload(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.service.get(slug).subscribe((loaded) => {
      this.staleConflict.set(null);
      this.applyLoaded(loaded);
    });
  }

  onStaleOverwrite(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.service.get(slug).subscribe((loaded) => {
      const writeBody = this.buildWriteBody();
      this.service.put(slug, writeBody, loaded.etag).subscribe((result) => {
        if (result.kind === 'saved') {
          this.setLoadedAfterSave(slug, writeBody, result.etag);
          this.staleConflict.set(null);
        }
      });
    });
  }

  private setLoadedAfterSave(
    slug: string,
    writeBody: SavedQueryWriteBody,
    etag: string,
  ): void {
    this.detail.set({
      kind: 'loaded',
      slug,
      loadedBody: writeBody.body,
      loadedEtag: etag,
      loadedParameters: writeBody.parameters ?? [],
    });
    this.refreshLibrary();
  }

  private buildWriteBody(): SavedQueryWriteBody {
    return toWriteBody(this.draftBody(), this.draftParameters());
  }

  onDelete(): void {
    const d = this.detail();
    if (d.kind !== 'loaded') return;
    this.deleteController.start(d.slug, d.loadedEtag);
  }

  onRun(): void {
    if (!this.sourceId()) return;
    this.executeSparql(this.draftBody());
  }

  onSubmitBindings(bindings: ParameterBindings): void {
    if (!this.sourceId()) return;
    const result = substitute(
      { body: this.draftBody(), parameters: this.draftParameters() },
      bindings,
    );
    if (result.isErr()) return;
    this.executeSparql(result.value);
  }

  private executeSparql(sparql: string): void {
    this.resultState.set({ kind: 'loading' });
    runSparql(this.http, this.sourceId(), sparql).subscribe((state) =>
      this.resultState.set(state),
    );
  }

  private refreshLibrary(after?: () => void): void {
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
    this.detail.set({ kind: 'loading', slug });
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
    this.draftBody.set(loaded.entry.body);
    this.draftParameters.set(parameters);
  }
}
