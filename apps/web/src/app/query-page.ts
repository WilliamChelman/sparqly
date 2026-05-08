import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConfigService,
  type DisplayContext,
  type SourceListingEntry,
} from './config.service';
import { SourcesPicker } from './sources-picker';
import { YasqeEditor } from './yasqe-editor';
import { YasrViewer } from './yasr-viewer';

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

const DEFAULT_BODY = 'SELECT * WHERE {\n  ?s ?p ?o .\n} LIMIT 10';

function buildDefaultQuery(context: DisplayContext): string {
  const lines: string[] = [];
  if (context.base) lines.push(`BASE <${context.base}>`);
  for (const [prefix, iri] of Object.entries(context.prefixes)) {
    lines.push(`PREFIX ${prefix}: <${iri}>`);
  }
  if (lines.length > 0) lines.push('');
  return lines.join('\n') + DEFAULT_BODY;
}

@Component({
  selector: 'app-query-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourcesPicker, YasqeEditor, YasrViewer],
  template: `
    <header class="border-b border-slate-200 bg-white px-4 py-3">
      <h1 class="text-lg font-semibold text-slate-900">sparqly playground</h1>
      <p class="text-sm text-slate-600">
        Querying
        <code class="rounded bg-slate-100 px-1 py-0.5"
          >/api/sparql/{{ sourceId() || '…' }}</code
        >
      </p>
    </header>
    @if (sources() === null) {
      <main class="p-4 text-sm text-slate-500">loading…</main>
    } @else {
      <main class="flex flex-col gap-3 p-4">
        <app-sources-picker
          label="source"
          [value]="sourceId()"
          (valueChange)="sourceId.set($event)"
        />
        <app-yasqe-editor
          #editor
          data-testid="editor"
          [value]="query()"
          (valueChange)="query.set($event)"
        />
        <div>
          <button
            data-testid="run-query"
            type="button"
            class="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            [disabled]="running() || !sourceId()"
            (click)="run()"
          >
            {{ running() ? 'running…' : 'Run' }}
          </button>
        </div>
        @if (error(); as e) {
          <p
            data-testid="error"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ e }}
          </p>
        }
        <app-yasr-viewer [result]="result()" />
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
  readonly result = signal<unknown | null>(null);
  readonly error = signal<string | null>(null);
  private readonly hasUrlQuery: boolean;
  @ViewChild('editor') private editor: YasqeEditor | undefined;

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

  run(): void {
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);
    const url = `/api/sparql/${encodeURIComponent(this.sourceId())}`;
    const accept = acceptForQueryType(this.editor?.getQueryType());
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
          this.result.set({
            data: response.body ?? '',
            contentType:
              response.headers.get('Content-Type') ?? 'application/octet-stream',
            status: response.status,
          });
        },
        error: (e: HttpErrorResponse) => {
          this.running.set(false);
          const errBody = parseErrorBody(e?.error);
          this.error.set(errBody ?? e?.message ?? 'request failed');
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
