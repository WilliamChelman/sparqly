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
  decodeSparqlResult,
  detectQueryType,
  type DisplayContext,
  type SourceListingEntry,
} from '@app/core';
import { ButtonComponent } from '@app/modules/button';
import { CodeChipComponent } from '@app/modules/code-chip';
import { SourcesPickerComponent } from '@app/modules/sources-picker';
import { EditorFrameComponent } from './components/editor-frame.component';
import {
  ResultPaneComponent,
  type ResultPaneState,
} from './components/result/result-pane.component';

function acceptForQueryType(queryType: string | undefined): string | undefined {
  switch (queryType) {
    case 'SELECT':
    case 'ASK':
      return 'application/sparql-results+json';
    case 'CONSTRUCT':
    case 'DESCRIBE':
      return 'text/turtle';
    default:
      return undefined;
  }
}

const DEFAULT_BODY = 'SELECT ?s ?p ?o WHERE {\n  ?s ?p ?o .\n} LIMIT 10';

function buildDefaultQuery(context: DisplayContext): string {
  const lines: string[] = [];
  if (context.base) lines.push(`BASE <${context.base}>`);
  for (const [prefix, iri] of Object.entries(context.prefixes)) {
    lines.push(`PREFIX ${prefix}: <${iri}>`);
  }
  if (lines.length > 0) lines.push('');
  return lines.join('\n') + '\n' + DEFAULT_BODY;
}

@Component({
  selector: 'app-query-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CodeChipComponent,
    SourcesPickerComponent,
    EditorFrameComponent,
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
          (valueChange)="query.set($event)"
        />
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
  private readonly hasUrlQuery: boolean;

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const source = params.get('source');
    const query = params.get('query');
    if (source) this.sourceId.set(source);
    this.hasUrlQuery = query !== null;
    if (query !== null) this.query.set(query);

    effect(() => {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          source: this.sourceId() || null,
          query: this.query() || null,
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
      if (!this.hasUrlQuery) {
        this.query.set(buildDefaultQuery(config.context));
      }
    });
  }

  onSourceChange(id: string): void {
    if (id === this.sourceId()) return;
    this.sourceId.set(id);
    this.resultState.set({ kind: 'empty' });
  }

  run(): void {
    this.running.set(true);
    this.resultState.set({ kind: 'loading' });
    const url = `/api/sparql/${encodeURIComponent(this.sourceId())}`;
    const accept = acceptForQueryType(this.queryType());
    const headers: Record<string, string> = {
      'Content-Type': 'application/sparql-query',
    };
    if (accept) headers['Accept'] = accept;
    this.http
      .post(url, this.query(), {
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

function parseErrorBody(body: unknown): string | undefined {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch {
      return body || undefined;
    }
    return body || undefined;
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return undefined;
}
