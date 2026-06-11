import { HttpErrorResponse } from '@angular/common/http';
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
import { Title } from '@angular/platform-browser';
import {
  ConfigService,
  SavedQueriesService,
  SparqlClientService,
  pageTitle,
  sourceTitleToken,
  type DisplayContext,
  type SavedQuerySummary,
  type SourceListingEntry,
} from '@app/core';
import { queryTitleSnippet } from './utils/query-title-snippet';
import {
  substitute,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';
import { ButtonComponent } from '@app/modules/button';
import { CodeChipComponent } from '@app/modules/code-chip';
import { LibraryComboboxComponent } from '@app/modules/library-combobox';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { EditorFrameComponent } from './components/editor-frame.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './components/result/result-pane.component';
import { encodeBindings, parseBindings } from './utils/bindings-url';
import { buildDefaultQuery } from './utils/sparql-defaults';

@Component({
  selector: 'app-query-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CodeChipComponent,
    SourcesPickerComponent,
    EditorFrameComponent,
    LibraryComboboxComponent,
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
        <div class="flex flex-wrap items-start gap-2">
          <app-sources-picker
            label="source"
            [value]="sourceId()"
            (valueChange)="onSourceChange($event)"
          />
          <app-library-combobox
            [entries]="savedQueries()"
            [selectedSlug]="pinnedSlug()"
            (load)="onLoad($event)"
          />
        </div>
        <app-editor-frame
          #frame
          name="query"
          [value]="query()"
          [loadError]="loadError() ?? undefined"
          [parameters]="loadedParameters() ?? undefined"
          [initialBindings]="initialBindings() ?? undefined"
          [showParameters]="pinnedSlug() !== null"
          (valueChange)="query.set($event)"
          (submitBindings)="onSubmitBindings($event)"
        />
        <div class="flex items-center gap-2">
          <button
            app-btn
            variant="primary"
            type="button"
            [loading]="running()"
            [disabled]="!sourceId()"
            (click)="run()"
          >
            {{ running() ? 'running…' : 'Run' }}
          </button>
          <button
            app-btn
            variant="secondary"
            type="button"
            [disabled]="!sourceId() || running()"
            (click)="runRefresh()"
            title="Re-run, recomputing any cached result"
          >
            Force refresh
          </button>
        </div>
        <app-result-pane
          [state]="resultState()"
          [context]="context()"
          [source]="sourceId() || undefined"
        />
      </main>
    }
  `,
})
export class QueryPage implements OnInit {
  private readonly configService = inject(ConfigService);
  private readonly savedQueriesService = inject(SavedQueriesService);
  private readonly sparqlClient = inject(SparqlClientService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly sourceId = signal<string>('');
  readonly query = signal<string>('');
  readonly running = signal<boolean>(false);
  readonly resultState = signal<ResultPaneState>({ kind: 'empty' });
  readonly context = signal<DisplayContext>({ prefixes: {} });
  readonly savedQueries = signal<readonly SavedQuerySummary[]>([]);
  readonly loadedSlug = signal<string | null>(null);
  readonly loadedBody = signal<string | null>(null);
  readonly loadedParameters = signal<ReadonlyArray<ParameterDeclaration> | null>(
    null,
  );
  readonly loadError = signal<{ kind: 'not-found'; slug: string } | null>(null);
  readonly initialBindings = signal<ParameterBindings | null>(null);
  readonly pinnedSlug = computed(() => {
    const slug = this.loadedSlug();
    const body = this.loadedBody();
    return slug !== null && body !== null && this.query() === body ? slug : null;
  });
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
      const source = sourceTitleToken(this.sourceId());
      const snippet = queryTitleSnippet(this.query());
      const value = [source, snippet].filter((part) => part.length > 0).join(' · ');
      this.title.setTitle(pageTitle(value, 'Playground'));
    });

    effect(() => {
      const pinned = this.pinnedSlug();
      const body = this.query();
      const bindings = this.bindings();
      const known = this.knownBindKeys();
      const bindParams: Record<string, string | string[] | null> = {};
      for (const key of known) bindParams[`bind.${key}`] = null;
      if (pinned !== null && bindings !== null) {
        Object.assign(bindParams, encodeBindings(bindings));
      }
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          source: this.sourceId() || null,
          query: pinned !== null ? null : body || null,
          savedQuery: pinned,
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
        this.loadedParameters.set(loaded.entry.parameters ?? null);
      },
      error: (err: HttpErrorResponse) => {
        if (err?.status === 404) {
          this.loadError.set({ kind: 'not-found', slug });
        }
      },
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

  /**
   * Force refresh (ADR-0054, #418): recompute a cached result. The standard
   * `Cache-Control: no-cache` request directive maps to the Query cache's
   * `refresh` on the server — execute and replace the stored entry.
   */
  runRefresh(): void {
    this.executeSparql(this.query(), { refresh: true });
  }

  private executeSparql(
    sparql: string,
    options: { refresh?: boolean } = {},
  ): void {
    this.running.set(true);
    this.resultState.set({ kind: 'loading' });
    this.sparqlClient
      .run(this.sourceId(), sparql, options)
      .subscribe((outcome) => {
        this.running.set(false);
        this.resultState.set(outcome);
      });
  }
}
