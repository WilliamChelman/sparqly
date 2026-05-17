import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
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
  SavedQueriesService,
  decodeSparqlResult,
  detectQueryType,
  type LoadedSavedQuery,
  type SavedQuerySummary,
} from '@app/core';
import { ButtonComponent } from '@app/modules/button';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import {
  substitute,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';
import { ParameterFormComponent } from '../query/components/parameter-form.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from '../query/components/result/result-pane.component';
import { parseErrorBody } from '../query/utils/parse-error-body';
import { acceptForQueryType } from '../query/utils/sparql-defaults';

type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading'; slug: string }
  | { kind: 'loaded'; entry: LoadedSavedQuery['entry'] }
  | { kind: 'not-found'; slug: string };

@Component({
  selector: 'app-queries-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    SourcesPickerComponent,
    ResultPaneComponent,
    ParameterFormComponent,
  ],
  template: `
    <header class="border-b border-border-muted bg-surface px-4 py-3">
      <h1 class="font-serif text-2xl italic text-foreground">saved queries</h1>
      <p class="text-sm text-foreground-muted">
        Browse the saved-query library. Select an entry to view its body.
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
          @case ('loaded') {
            <pre
              data-testid="queries-detail-body"
              class="overflow-auto rounded border border-border-muted bg-surface p-3 font-mono text-sm text-foreground"
            >{{ loadedBody() }}</pre>
            <div class="mt-3 flex flex-col gap-3">
              <app-sources-picker
                label="source"
                [value]="sourceId()"
                (valueChange)="onSourceChange($event)"
              />
              <div>
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
              @if (hasParameters()) {
                <app-parameter-form
                  [parameters]="loadedParameters()"
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly entries = signal<readonly SavedQuerySummary[]>([]);
  readonly filter = signal<string>('');
  readonly selectedSlug = signal<string | null>(null);
  readonly detail = signal<DetailState>({ kind: 'empty' });
  readonly sourceId = signal<string>('');
  readonly resultState = signal<ResultPaneState>({ kind: 'empty' });

  readonly visibleEntries = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const sorted = [...this.entries()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    if (needle === '') return sorted;
    return sorted.filter((e) => e.slug.toLowerCase().includes(needle));
  });

  readonly loadedBody = computed(() => {
    const d = this.detail();
    return d.kind === 'loaded' ? d.entry.body : '';
  });

  readonly notFoundSlug = computed(() => {
    const d = this.detail();
    return d.kind === 'not-found' ? d.slug : '';
  });

  readonly loadedParameters = computed<ReadonlyArray<ParameterDeclaration>>(
    () => {
      const d = this.detail();
      if (d.kind !== 'loaded') return [];
      return d.entry.parameters ?? [];
    },
  );

  readonly hasParameters = computed(() => this.loadedParameters().length > 0);

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    const source = this.route.snapshot.queryParamMap.get('source');
    if (source) this.sourceId.set(source);
    this.service.list().subscribe((entries) => {
      this.entries.set(entries);
      if (slug !== null) this.loadSlug(slug);
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
    // Navigation re-mounts the component for the new param; the fresh
    // instance's ngOnInit reads the slug and loads the entry. Preserve
    // page-level query params (?source=…) across the slug switch.
    void this.router.navigate(['/queries', slug], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
    });
  }

  onRun(): void {
    const d = this.detail();
    if (d.kind !== 'loaded') return;
    if (!this.sourceId()) return;
    this.executeSparql(d.entry.body);
  }

  onSubmitBindings(bindings: ParameterBindings): void {
    const d = this.detail();
    if (d.kind !== 'loaded') return;
    if (!this.sourceId()) return;
    const parameters = d.entry.parameters ?? [];
    const result = substitute({ body: d.entry.body, parameters }, bindings);
    if (result.isErr()) return;
    this.executeSparql(result.value);
  }

  private executeSparql(sparql: string): void {
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
          const contentType =
            response.headers.get('Content-Type') ?? 'application/octet-stream';
          const body = response.body ?? '';
          this.resultState.set({
            kind: 'result',
            result: decodeSparqlResult(body, contentType),
          });
        },
        error: (e: HttpErrorResponse) => {
          const errBody = parseErrorBody(e?.error);
          const message = errBody ?? e?.message ?? 'request failed';
          this.resultState.set({ kind: 'error', message });
        },
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
        this.detail.set({ kind: 'loaded', entry: loaded.entry });
      },
      error: () => {
        if (this.selectedSlug() !== slug) return;
        this.detail.set({ kind: 'not-found', slug });
      },
    });
  }
}
