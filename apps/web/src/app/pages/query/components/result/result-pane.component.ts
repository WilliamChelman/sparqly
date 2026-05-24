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
  Triple,
  TripleResult,
} from '@app/core';
import { CardComponent } from '@app/modules/card';
import { type CodeLine } from '@app/modules/code-highlight';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { parseRdfString, type FormatSerialization } from 'common';
import { DataFactory, type Quad } from 'n3';
import {
  resultToFormatted,
  type FormattedResult,
} from '../../utils/result-to-formatted';
import { reifySelectSpo } from '../../utils/select-spo-reifier';
import {
  askDownloads,
  formattedDownload,
  selectDownloads,
  tripleDownloads,
  type DownloadOption,
} from '../../utils/result-downloads';
import { highlightFormatted, highlightRaw } from '../../utils/highlight-result';
import { ErrorConstellationComponent } from './error-constellation.component';
import { FormattedResultComponent } from './formatted-result.component';
import { HeroIllustrationComponent } from './hero-illustration.component';
import { LoadingConstellationComponent } from './loading-constellation.component';
import { ResultAskComponent } from './result-ask.component';
import { ResultRawComponent } from './result-raw.component';
import { ResultTableSelectComponent } from './result-table-select.component';
import { ResultTableTriplesComponent } from './result-table-triples.component';
import { StateCardComponent } from './state-card.component';

export type ResultPaneState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; result: DecodedResult };

type Tab = 'table' | 'turtle' | 'raw' | 'download';

@Component({
  selector: 'app-result-pane',
  standalone: true,
  imports: [
    CardComponent,
    ErrorConstellationComponent,
    EyebrowComponent,
    FormattedResultComponent,
    HeroIllustrationComponent,
    LoadingConstellationComponent,
    ResultAskComponent,
    ResultRawComponent,
    ResultTableSelectComponent,
    ResultTableTriplesComponent,
    StateCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state().kind) {
      @case ('empty') {
        <app-state-card>
          <div illustration><app-hero-illustration /></div>
          <div title>Run a query</div>
          <div copy>
            Edit the query above and press <strong>Run</strong> to see results here.
          </div>
        </app-state-card>
      }
      @case ('loading') {
        <app-state-card>
          <div illustration><app-loading-constellation /></div>
          <div title>Running…</div>
          <div copy>Awaiting response from the SPARQL endpoint.</div>
        </app-state-card>
      }
      @case ('error') {
        <app-state-card>
          <div illustration><app-error-constellation /></div>
          <div title>Query failed</div>
          <div copy>{{ errorMessage() }}</div>
        </app-state-card>
      }
      @case ('result') {
        <div app-card>
          <div
            app-eyebrow
            class="flex items-center justify-between gap-4 border-b border-border-muted bg-surface-sunken px-4 py-2.5 text-[11px]"
          >
            <nav role="tablist" class="flex gap-3.5">
              @for (t of tabs(); track t.id) {
                <button
                  app-eyebrow
                  role="tab"
                  type="button"
                  [attr.aria-selected]="activeTab() === t.id"
                  (click)="setTab(t.id)"
                  class="cursor-pointer border-b border-transparent bg-transparent px-0 py-1 transition-colors duration-[180ms] hover:text-foreground-muted aria-selected:border-accent aria-selected:text-foreground"
                >{{ t.label }}</button>
              }
            </nav>
            <span class="text-foreground-muted">{{ headerMeta() }}</span>
          </div>
          <div>
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
                  <app-result-raw
                    [text]="r!.raw"
                    [contentType]="r!.contentType"
                    [lines]="rawHighlightLines()"
                  />
                }
              }
              @case ('turtle') {
                @let f = formatted();
                @if (f) {
                  <app-formatted-result
                    [body]="f.body"
                    [serialization]="f.serialization"
                    [lines]="formattedHighlightLines()"
                  />
                }
              }
              @case ('raw') {
                @let r = currentResult();
                @if (r) {
                  <app-result-raw
                    [text]="r.raw"
                    [contentType]="r.contentType"
                    [lines]="rawHighlightLines()"
                  />
                }
              }
              @case ('download') {
                <ul class="flex flex-col gap-2 p-4">
                  @for (opt of downloadOptions(); track opt.id) {
                    <li>
                      <a
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
export class ResultPaneComponent {
  readonly state = input.required<ResultPaneState>();
  readonly context = input<DisplayContext>({ prefixes: {} });

  private readonly _activeTab = signal<Tab>('table');
  readonly activeTab = this._activeTab.asReadonly();

  // Memo of formatted bodies keyed on DecodedResult identity. WeakMap entries
  // drop with the result, so a new query naturally discards the prior memo.
  private readonly _formatCache = new WeakMap<DecodedResult, FormattedResult>();
  private readonly _reifiedCache = new WeakMap<
    SelectResult,
    ReadonlyArray<Triple>
  >();
  // Memo of `raw`-tab highlight token models — `null` means "render plain".
  private readonly _highlightCache = new WeakMap<
    DecodedResult,
    CodeLine[] | null
  >();
  // Memo of `turtle`/`trig`-tab highlight token models — `null` means "render plain".
  private readonly _formatHighlightCache = new WeakMap<
    DecodedResult,
    CodeLine[] | null
  >();

  readonly currentResult = computed<DecodedResult | null>(() => {
    const s = this.state();
    return s.kind === 'result' ? s.result : null;
  });

  readonly serialization = computed<FormatSerialization | null>(() => {
    const r = this.currentResult();
    if (!r) return null;
    if (r.kind === 'triples') {
      return r.triples.some((t) => t.graph) ? 'trig' : 'turtle';
    }
    if (r.kind === 'select') {
      const reified = this.reifiedSelect(r);
      if (!reified || reified.length === 0) return null;
      return reified.some((t) => t.graph) ? 'trig' : 'turtle';
    }
    return null;
  });

  readonly formatted = computed<FormattedResult | null>(() => {
    const r = this.currentResult();
    const tab = this._activeTab();
    if (!r) return null;
    if (tab !== 'turtle' && tab !== 'download') return null;
    let cached = this._formatCache.get(r);
    if (!cached) {
      const ctx = this.context();
      if (r.kind === 'triples') {
        const parsed = parseRdfString(r.raw);
        cached = resultToFormatted(parsed.quads, parsed.prefixes, parsed.base, ctx);
      } else if (r.kind === 'select') {
        const reified = this.reifiedSelect(r);
        if (!reified || reified.length === 0) return null;
        const quads = reified.map(tripleToQuad);
        cached = resultToFormatted(quads, {}, undefined, ctx);
      } else {
        return null;
      }
      this._formatCache.set(r, cached);
    }
    return cached;
  });

  // Token model for the `raw` tab. Computed lazily — only while `raw` is the
  // active tab (or for a raw-kind result, which the `table` tab also shows) —
  // and memoized per DecodedResult so switching to `table` is never slowed and
  // re-opening `raw` is instant. Mirrors the `formatted()` memoization above.
  readonly rawHighlightLines = computed<CodeLine[] | null>(() => {
    const r = this.currentResult();
    const tab = this._activeTab();
    if (!r) return null;
    if (tab !== 'raw' && !(tab === 'table' && r.kind === 'raw')) return null;
    if (this._highlightCache.has(r)) {
      return this._highlightCache.get(r) ?? null;
    }
    const lines = highlightRaw(r.raw, r.contentType);
    this._highlightCache.set(r, lines);
    return lines;
  });

  // Computed lazily, only while `turtle` is the active tab, and memoized per
  // DecodedResult so re-opening the tab is instant.
  readonly formattedHighlightLines = computed<CodeLine[] | null>(() => {
    const r = this.currentResult();
    if (!r || this._activeTab() !== 'turtle') return null;
    if (this._formatHighlightCache.has(r)) {
      return this._formatHighlightCache.get(r) ?? null;
    }
    const f = this.formatted();
    if (!f) return null;
    const lines = highlightFormatted(f.body);
    this._formatHighlightCache.set(r, lines);
    return lines;
  });

  private reifiedSelect(r: SelectResult): ReadonlyArray<Triple> | null {
    const cached = this._reifiedCache.get(r);
    if (cached) return cached;
    const reified = reifySelectSpo(r);
    if (reified === null) return null;
    this._reifiedCache.set(r, reified);
    return reified;
  }

  readonly tabs = computed<
    ReadonlyArray<{ id: Tab; testId: string; label: string }>
  >(() => {
    const out: { id: Tab; testId: string; label: string }[] = [
      { id: 'table', testId: 'table', label: 'table' },
    ];
    const ser = this.serialization();
    if (ser) {
      out.push({ id: 'turtle', testId: ser, label: ser });
    }
    out.push({ id: 'raw', testId: 'raw', label: 'raw' });
    out.push({ id: 'download', testId: 'download', label: 'download' });
    return out;
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
    if (r.kind === 'select') {
      const base = selectDownloads(r);
      const reified = this.reifiedSelect(r);
      if (reified && reified.length > 0) {
        const formatted = this.formatted();
        if (formatted) base.push(formattedDownload(formatted));
      }
      return base;
    }
    if (r.kind === 'ask') return askDownloads(r);
    if (r.kind === 'triples') return tripleDownloads(r, this.formatted());
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

function tripleToQuad(t: Triple): Quad {
  const { namedNode, blankNode, literal, defaultGraph, quad } = DataFactory;
  const subject =
    t.subject.termType === 'NamedNode'
      ? namedNode(t.subject.value)
      : blankNode(t.subject.value);
  const predicate = namedNode(t.predicate.value);
  const object =
    t.object.termType === 'NamedNode'
      ? namedNode(t.object.value)
      : t.object.termType === 'BlankNode'
        ? blankNode(t.object.value)
        : t.object.datatype
          ? literal(t.object.value, namedNode(t.object.datatype.value))
          : t.object.language
            ? literal(t.object.value, t.object.language)
            : literal(t.object.value);
  const graph = t.graph
    ? t.graph.termType === 'NamedNode'
      ? namedNode(t.graph.value)
      : blankNode(t.graph.value)
    : defaultGraph();
  return quad(subject, predicate, object, graph);
}
