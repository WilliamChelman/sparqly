import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConfigService,
  SavedQueriesService,
  decodeSparqlResult,
  detectQueryType,
  type DisplayContext,
  type SavedQuerySummary,
  type SourceListingEntry,
} from '@app/core';
import {
  substitute,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';
import { ButtonComponent } from '@app/modules/button';
import { CodeChipComponent } from '@app/modules/code-chip';
import { LibraryPickerComponent } from '@app/modules/library-picker';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { EditorFrameComponent } from './components/editor-frame.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './components/result/result-pane.component';
import { encodeBindings, parseBindings } from './utils/bindings-url';
import { parseErrorBody } from './utils/parse-error-body';
import {
  acceptForQueryType,
  buildDefaultQuery,
} from './utils/sparql-defaults';

@Component({
  selector: 'app-query-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CodeChipComponent,
    SourcesPickerComponent,
    EditorFrameComponent,
    LibraryPickerComponent,
    ResultPaneComponent,
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">
        sparqly playground
      </h1>
      <p class="text-sm text-foreground-muted">
        Querying
        <code app-code-chip>/api/sparql/{{ sourceId() || '…' }}</code>
      </p>
    </header>
    @if (sources() === null) {
      <main class="p-4 text-sm text-foreground-faint">loading…</main>
    } @else {
      <main class="flex flex-col gap-3 p-4">
        <app-sources-picker
          label="source"
          [value]="sourceId()"
          (valueChange)="onSourceChange($event)"
        />
        <app-editor-frame
          #frame
          data-testid="editor"
          name="query"
          [value]="query()"
          [loadedSlug]="loadedSlug() ?? undefined"
          [loadedBody]="loadedBody() ?? undefined"
          [loadError]="loadError() ?? undefined"
          [writable]="writable()"
          [parameters]="loadedParameters() ?? undefined"
          [initialBindings]="initialBindings() ?? undefined"
          (valueChange)="query.set($event)"
          (save)="onSave()"
          (saveAs)="onSaveAs()"
          (delete)="onDelete()"
          (submitBindings)="onSubmitBindings($event)"
          (parametersDraftChange)="onParametersDraftChange($event)"
        />
        <app-library-picker
          [entries]="savedQueries()"
          [writable]="writable()"
          (load)="onLoad($event)"
          (delete)="onLibraryDelete($event)"
        />
        @if (saveAsOpen()) {
          <div
            data-testid="save-as-dialog"
            role="dialog"
            class="flex flex-col gap-2 rounded border border-border-muted bg-surface p-3 text-sm"
          >
            <label class="flex flex-col gap-1">
              <span class="text-foreground-muted">Save as (slug):</span>
              <input
                type="text"
                data-testid="save-as-slug"
                [value]="saveAsSlug()"
                (input)="onSaveAsSlugInput($event)"
              />
            </label>
            @if (saveAsError()) {
              <p
                data-testid="save-as-collision"
                class="text-danger"
              >
                {{ saveAsError() }}
              </p>
            }
            <div class="flex gap-2">
              <button
                app-btn
                type="button"
                variant="primary"
                size="sm"
                data-testid="save-as-submit"
                (click)="onSaveAsSubmit()"
              >
                Save
              </button>
              <button
                app-btn
                type="button"
                variant="ghost"
                size="sm"
                data-testid="save-as-cancel"
                (click)="onSaveAsCancel()"
              >
                Cancel
              </button>
            </div>
          </div>
        }
        @if (staleConflict()) {
          <div
            data-testid="stale-dialog"
            role="dialog"
            class="rounded border border-warning bg-surface p-3 text-sm"
          >
            <p>
              <strong>{{ staleConflict() }}</strong> was changed elsewhere.
              Reload to see the current version, or overwrite.
            </p>
            <div class="mt-2 flex gap-2">
              <button
                app-btn
                type="button"
                variant="secondary"
                size="sm"
                data-testid="stale-reload"
                (click)="onStaleReload()"
              >
                Reload
              </button>
              <button
                app-btn
                type="button"
                variant="primary"
                size="sm"
                data-testid="stale-overwrite"
                (click)="onStaleOverwrite()"
              >
                Overwrite
              </button>
            </div>
          </div>
        }
        <div>
          <button
            app-btn
            variant="primary"
            data-testid="run-query"
            type="button"
            [loading]="running()"
            [disabled]="!sourceId()"
            (click)="run()"
          >
            {{ running() ? 'running…' : 'Run' }}
          </button>
        </div>
        <app-result-pane [state]="resultState()" [context]="context()" />
      </main>
    }
  `,
})
export class QueryPage implements OnInit {
  private readonly configService = inject(ConfigService);
  private readonly savedQueriesService = inject(SavedQueriesService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly sourceId = signal<string>('');
  readonly query = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly resultState = signal<ResultPaneState>({ kind: 'empty' });
  readonly context = signal<DisplayContext>({ prefixes: {} });
  readonly queryType = computed(() => detectQueryType(this.query()));
  readonly savedQueries = signal<readonly SavedQuerySummary[]>([]);
  readonly loadedSlug = signal<string | null>(null);
  readonly loadedBody = signal<string | null>(null);
  readonly loadedEtag = signal<string | null>(null);
  readonly loadedParameters = signal<ReadonlyArray<ParameterDeclaration> | null>(
    null,
  );
  readonly staleConflict = signal<string | null>(null);
  readonly saveAsOpen = signal<boolean>(false);
  readonly saveAsSlug = signal<string>('');
  readonly saveAsError = signal<string | null>(null);
  readonly writable = signal<boolean>(true);
  readonly loadError = signal<{ kind: 'not-found'; slug: string } | null>(null);
  readonly initialBindings = signal<ParameterBindings | null>(null);
  private readonly bindings = signal<ParameterBindings | null>(null);
  private readonly knownBindKeys = signal<ReadonlySet<string>>(new Set());
  private readonly hasUrlQuery: boolean;
  private readonly bootSavedQuerySlug: string | null;

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const source = params.get('source');
    const query = params.get('query');
    const savedQuery = params.get('savedQuery');
    if (source) this.sourceId.set(source);
    this.bootSavedQuerySlug = savedQuery;
    this.hasUrlQuery = savedQuery === null && query !== null;
    if (savedQuery === null && query !== null) this.query.set(query);
    if (savedQuery !== null) {
      const parsed = parseBindings(params);
      if (parsed !== null) {
        this.initialBindings.set(parsed);
        this.bindings.set(parsed);
        this.knownBindKeys.set(new Set(Object.keys(parsed)));
      }
    }

    effect(() => {
      const slug = this.loadedSlug();
      const loadedBody = this.loadedBody();
      const body = this.query();
      const pinnedToSlug = slug !== null && body === loadedBody;
      const bindings = this.bindings();
      const known = this.knownBindKeys();
      const bindParams: Record<string, string | string[] | null> = {};
      for (const key of known) bindParams[`bind.${key}`] = null;
      if (pinnedToSlug && bindings !== null) {
        Object.assign(bindParams, encodeBindings(bindings));
      }
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          source: this.sourceId() || null,
          query: pinnedToSlug ? null : body || null,
          savedQuery: pinnedToSlug ? slug : null,
          ...bindParams,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  ngOnInit(): void {
    this.configService.config().subscribe((config) => {
      this.sources.set(config.sources);
      this.context.set(config.context);
      this.writable.set(config.savedQueries?.writable ?? true);
      if (this.sourceId() === '') {
        const def = config.sources.find((s) => s.default === true);
        const initial = def?.id ?? config.sources[0]?.id ?? '';
        if (initial !== '') this.sourceId.set(initial);
      }
      if (!this.hasUrlQuery && this.bootSavedQuerySlug === null) {
        this.query.set(buildDefaultQuery(config.context));
      }
    });
    this.refreshLibrary();
    if (this.bootSavedQuerySlug !== null) {
      this.onLoad(this.bootSavedQuerySlug);
    }
  }

  private refreshLibrary(): void {
    this.savedQueriesService.list().subscribe((entries) => {
      this.savedQueries.set(entries);
    });
  }

  onLoad(slug: string): void {
    this.savedQueriesService.get(slug).subscribe({
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

  onSave(): void {
    const slug = this.loadedSlug();
    const etag = this.loadedEtag();
    if (slug === null || etag === null) return;
    this.savedQueriesService
      .put(slug, this.buildWriteBody(), etag)
      .subscribe((result) => {
        if (result.kind === 'saved') {
          this.loadedBody.set(this.query());
          this.loadedEtag.set(result.etag);
          this.refreshLibrary();
        } else if (result.kind === 'stale') {
          this.staleConflict.set(slug);
        }
      });
  }

  onParametersDraftChange(parameters: ReadonlyArray<ParameterDeclaration>): void {
    this.loadedParameters.set(parameters.length === 0 ? null : parameters);
  }

  private buildWriteBody() {
    const params = this.loadedParameters();
    return {
      body: this.query(),
      ...(params && params.length > 0 ? { parameters: params } : {}),
    };
  }

  onStaleReload(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.savedQueriesService.get(slug).subscribe((loaded) => {
      this.query.set(loaded.entry.body);
      this.loadedSlug.set(loaded.entry.slug);
      this.loadedBody.set(loaded.entry.body);
      this.loadedEtag.set(loaded.etag);
      this.staleConflict.set(null);
    });
  }

  onStaleOverwrite(): void {
    const slug = this.staleConflict();
    if (slug === null) return;
    this.savedQueriesService.get(slug).subscribe((loaded) => {
      this.savedQueriesService
        .put(slug, this.buildWriteBody(), loaded.etag)
        .subscribe((result) => {
          if (result.kind === 'saved') {
            this.loadedSlug.set(slug);
            this.loadedBody.set(this.query());
            this.loadedEtag.set(result.etag);
            this.staleConflict.set(null);
            this.refreshLibrary();
          }
        });
    });
  }

  onSaveAs(): void {
    this.saveAsSlug.set('');
    this.saveAsError.set(null);
    this.saveAsOpen.set(true);
  }

  onSaveAsSlugInput(event: Event): void {
    this.saveAsSlug.set((event.target as HTMLInputElement).value);
    this.saveAsError.set(null);
  }

  onSaveAsSubmit(): void {
    const slug = this.saveAsSlug().trim();
    if (slug === '') return;
    this.savedQueriesService
      .put(slug, this.buildWriteBody())
      .subscribe((result) => {
        if (result.kind === 'saved') {
          this.loadedSlug.set(slug);
          this.loadedBody.set(this.query());
          this.loadedEtag.set(result.etag);
          this.saveAsOpen.set(false);
          this.refreshLibrary();
        } else if (result.kind === 'slug-exists') {
          this.saveAsError.set(`A query with slug "${slug}" already exists.`);
        }
      });
  }

  onSaveAsCancel(): void {
    this.saveAsOpen.set(false);
    this.saveAsError.set(null);
  }

  onDelete(): void {
    const slug = this.loadedSlug();
    const etag = this.loadedEtag();
    if (slug === null || etag === null) return;
    this.savedQueriesService.delete(slug, etag).subscribe((result) => {
      if (result.kind === 'deleted') {
        this.loadedSlug.set(null);
        this.loadedBody.set(null);
        this.loadedEtag.set(null);
        this.refreshLibrary();
      }
    });
  }

  onLibraryDelete(slug: string): void {
    this.savedQueriesService.get(slug).subscribe((loaded) => {
      this.savedQueriesService
        .delete(slug, loaded.etag)
        .subscribe((result) => {
          if (result.kind === 'deleted') {
            if (this.loadedSlug() === slug) {
              this.loadedSlug.set(null);
              this.loadedBody.set(null);
              this.loadedEtag.set(null);
            }
            this.refreshLibrary();
          }
        });
    });
  }

  onSubmitBindings(bindings: ParameterBindings): void {
    const parameters = this.loadedParameters();
    if (parameters === null) return;
    const result = substitute(
      { body: this.query(), parameters },
      bindings,
    );
    if (result.isErr()) return;
    this.bindings.set(bindings);
    this.knownBindKeys.update((prev) => {
      const next = new Set(prev);
      for (const k of Object.keys(bindings)) next.add(k);
      return next;
    });
    this.executeSparql(result.value);
  }

  onSourceChange(id: string): void {
    if (id === this.sourceId()) return;
    this.sourceId.set(id);
    this.resultState.set({ kind: 'empty' });
  }

  run(): void {
    this.executeSparql(this.query());
  }

  private executeSparql(sparql: string): void {
    this.running.set(true);
    this.resultState.set({ kind: 'loading' });
    const url = `/api/sparql/${encodeURIComponent(this.sourceId())}`;
    const accept = acceptForQueryType(detectQueryType(sparql));
    const headers: Record<string, string> = {
      'Content-Type': 'application/sparql-query',
    };
    if (accept) headers['Accept'] = accept;
    this.http
      .post(url, sparql, {
        headers: new HttpHeaders(headers),
        observe: 'response',
        responseType: 'text',
      })
      .subscribe({
        next: (response) => {
          this.running.set(false);
          const contentType =
            response.headers.get('Content-Type') ?? 'application/octet-stream';
          const body = response.body ?? '';
          this.resultState.set({
            kind: 'result',
            result: decodeSparqlResult(body, contentType),
          });
        },
        error: (e: HttpErrorResponse) => {
          this.running.set(false);
          const errBody = parseErrorBody(e?.error);
          const message = errBody ?? e?.message ?? 'request failed';
          this.resultState.set({ kind: 'error', message });
        },
      });
  }
}
