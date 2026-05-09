import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import type {
  AskResult,
  DecodedResult,
  DisplayContext,
  SelectResult,
  Term,
  Triple,
  TripleResult,
} from '@app/core';
import { exportBindingsCsv } from './csv-exporter';
import {
  ErrorConstellation,
  HeroIllustration,
  LoadingConstellation,
} from './result-illustrations';
import { ResultAsk } from './result-ask';
import { ResultRaw } from './result-raw';
import { ResultTableSelect } from './result-table-select';
import { ResultTableTriples } from './result-table-triples';
import { StateCard } from './state-card';

export type ResultPaneState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; result: DecodedResult };

type Tab = 'table' | 'raw' | 'download';

interface DownloadOption {
  id: string;
  label: string;
  filename: string;
  mediaType: string;
  body: string;
}

@Component({
  selector: 'app-result-pane',
  standalone: true,
  imports: [
    ErrorConstellation,
    HeroIllustration,
    LoadingConstellation,
    ResultAsk,
    ResultRaw,
    ResultTableSelect,
    ResultTableTriples,
    StateCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ('empty') {
        <div data-testid="result-empty">
          <app-state-card>
            <div illustration><app-hero-illustration /></div>
            <div title>Run a query</div>
            <div copy>
              Edit the query above and press <strong>Run</strong> to see results here.
            </div>
          </app-state-card>
        </div>
      }
      @case ('loading') {
        <div data-testid="result-loading">
          <app-state-card>
            <div illustration><app-loading-constellation /></div>
            <div title>Running…</div>
            <div copy>Awaiting response from the SPARQL endpoint.</div>
          </app-state-card>
        </div>
      }
      @case ('error') {
        <div data-testid="result-error">
          <app-state-card>
            <div illustration><app-error-constellation /></div>
            <div title>Query failed</div>
            <div copy>{{ errorMessage() }}</div>
          </app-state-card>
        </div>
      }
      @case ('result') {
        <div class="result-shell">
          <div class="result-shell__head">
            <nav role="tablist" class="result-shell__tabs">
              <button
                data-testid="tab-table"
                role="tab"
                type="button"
                [attr.aria-selected]="activeTab() === 'table'"
                (click)="setTab('table')"
              >table</button>
              <button
                data-testid="tab-raw"
                role="tab"
                type="button"
                [attr.aria-selected]="activeTab() === 'raw'"
                (click)="setTab('raw')"
              >raw</button>
              <button
                data-testid="tab-download"
                role="tab"
                type="button"
                [attr.aria-selected]="activeTab() === 'download'"
                (click)="setTab('download')"
              >download</button>
            </nav>
            <span class="meta">{{ headerMeta() }}</span>
          </div>
          <div class="result-shell__body">
            @switch (activeTab()) {
              @case ('table') {
                @let r = currentResult();
                @if (r?.kind === 'select') {
                  <app-result-table-select
                    [result]="asSelect(r)"
                    [context]="context()"
                  />
                }
                @if (r?.kind === 'triples') {
                  <app-result-table-triples
                    [result]="asTriples(r)"
                    [context]="context()"
                  />
                }
                @if (r?.kind === 'ask') {
                  <app-result-ask [result]="asAsk(r)" />
                }
                @if (r?.kind === 'raw') {
                  <app-result-raw [text]="r!.raw" [contentType]="r!.contentType" />
                }
              }
              @case ('raw') {
                @let r = currentResult();
                @if (r) {
                  <app-result-raw [text]="r.raw" [contentType]="r.contentType" />
                }
              }
              @case ('download') {
                <ul class="flex flex-col gap-2 p-4">
                  @for (opt of downloadOptions(); track opt.id) {
                    <li>
                      <a
                        [attr.data-testid]="'download-' + opt.id"
                        [attr.href]="dataUrlFor(opt)"
                        [attr.download]="opt.filename"
                        class="inline-block rounded border border-border-muted px-3 py-1.5 font-mono text-xs text-foreground-muted hover:border-accent hover:text-accent"
                      >
                        {{ opt.label }}
                        <span class="text-foreground-faint"
                          >({{ opt.filename }})</span
                        >
                      </a>
                    </li>
                  }
                </ul>
              }
            }
          </div>
        </div>
      }
    }
  `,
})
export class ResultPane {
  readonly state = input.required<ResultPaneState>();
  readonly context = input<DisplayContext>({ prefixes: {} });

  private readonly _activeTab = signal<Tab>('table');
  readonly activeTab = this._activeTab.asReadonly();

  readonly currentResult = computed<DecodedResult | null>(() => {
    const s = this.state();
    return s.kind === 'result' ? s.result : null;
  });

  readonly errorMessage = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.message : '';
  });

  readonly headerMeta = computed<string>(() => {
    const r = this.currentResult();
    if (!r) return '';
    if (r.kind === 'select') {
      return `${r.bindings.length} rows · ${r.variables.length} vars`;
    }
    if (r.kind === 'triples') {
      return `${r.triples.length} triples`;
    }
    if (r.kind === 'ask') {
      return r.value ? 'true' : 'false';
    }
    return r.contentType || '';
  });

  readonly downloadOptions = computed<DownloadOption[]>(() => {
    const r = this.currentResult();
    if (!r) return [];
    if (r.kind === 'select') return selectDownloads(r);
    if (r.kind === 'ask') return askDownloads(r);
    if (r.kind === 'triples') return tripleDownloads(r);
    return [];
  });

  setTab(t: Tab): void {
    this._activeTab.set(t);
  }

  asSelect(r: DecodedResult | null): SelectResult {
    return r as SelectResult;
  }
  asTriples(r: DecodedResult | null): TripleResult {
    return r as TripleResult;
  }
  asAsk(r: DecodedResult | null): AskResult {
    return r as AskResult;
  }

  dataUrlFor(opt: DownloadOption): string {
    return `data:${opt.mediaType};charset=utf-8,${encodeURIComponent(opt.body)}`;
  }
}

function selectDownloads(r: SelectResult): DownloadOption[] {
  const csv = exportBindingsCsv(r.variables, r.bindings);
  const tsv = exportBindingsCsv(r.variables, r.bindings, { delimiter: '\t' });
  const json =
    r.contentType === 'application/sparql-results+json'
      ? r.raw
      : reserializeSelectAsJson(r);
  return [
    {
      id: 'csv',
      label: 'CSV',
      filename: 'result.csv',
      mediaType: 'text/csv',
      body: csv,
    },
    {
      id: 'tsv',
      label: 'TSV',
      filename: 'result.tsv',
      mediaType: 'text/tab-separated-values',
      body: tsv,
    },
    {
      id: 'json',
      label: 'JSON',
      filename: 'result.json',
      mediaType: 'application/sparql-results+json',
      body: json,
    },
  ];
}

function askDownloads(r: AskResult): DownloadOption[] {
  const json =
    r.contentType === 'application/sparql-results+json'
      ? r.raw
      : JSON.stringify({ head: {}, boolean: r.value });
  return [
    {
      id: 'json',
      label: 'JSON',
      filename: 'result.json',
      mediaType: 'application/sparql-results+json',
      body: json,
    },
  ];
}

function tripleDownloads(r: TripleResult): DownloadOption[] {
  const turtle =
    r.contentType === 'text/turtle' ? r.raw : serializeNquads(r.triples);
  const nquads =
    r.contentType === 'application/n-quads'
      ? r.raw
      : serializeNquads(r.triples);
  return [
    {
      id: 'turtle',
      label: 'Turtle',
      filename: 'result.ttl',
      mediaType: 'text/turtle',
      body: turtle,
    },
    {
      id: 'nquads',
      label: 'N-Quads',
      filename: 'result.nq',
      mediaType: 'application/n-quads',
      body: nquads,
    },
  ];
}

function reserializeSelectAsJson(r: SelectResult): string {
  const bindings = r.bindings.map((row) => {
    const out: Record<string, { type: string; value: string; datatype?: string; 'xml:lang'?: string }> = {};
    for (const [name, term] of Object.entries(row)) {
      out[name] = sparqlJsonTerm(term);
    }
    return out;
  });
  return JSON.stringify({
    head: { vars: r.variables },
    results: { bindings },
  });
}

function sparqlJsonTerm(t: Term): { type: string; value: string; datatype?: string; 'xml:lang'?: string } {
  if (t.termType === 'NamedNode') return { type: 'uri', value: t.value };
  if (t.termType === 'BlankNode') return { type: 'bnode', value: t.value };
  const out: { type: string; value: string; datatype?: string; 'xml:lang'?: string } = {
    type: 'literal',
    value: t.value,
  };
  if (t.language) out['xml:lang'] = t.language;
  if (t.datatype?.value) out.datatype = t.datatype.value;
  return out;
}

function serializeNquads(triples: ReadonlyArray<Triple>): string {
  return triples
    .map((t) => {
      const parts = [
        nquadTerm(t.subject),
        nquadTerm(t.predicate),
        nquadTerm(t.object),
      ];
      if (t.graph) parts.push(nquadTerm(t.graph));
      return `${parts.join(' ')} .`;
    })
    .join('\n')
    .concat(triples.length > 0 ? '\n' : '');
}

function nquadTerm(t: Term): string {
  if (t.termType === 'NamedNode') return `<${t.value}>`;
  if (t.termType === 'BlankNode') return `_:${t.value}`;
  const lex = `"${t.value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
  if (t.language) return `${lex}@${t.language}`;
  if (t.datatype?.value && t.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
    return `${lex}^^<${t.datatype.value}>`;
  }
  return lex;
}
