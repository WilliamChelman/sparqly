import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { DEFAULT_PREFIXES, shortenNQuadLine } from 'common';
import type {
  DiffResponse,
  GraphDiffResponse,
  SourceRecord,
  TabularDiffEntry,
  TabularDiffResponse,
  TabularTerm,
} from './diff.service';
import { SourceSnippet } from './source-snippet';

@Component({
  selector: 'app-diff-result-renderer',
  standalone: true,
  imports: [SourceSnippet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalsLine(); as line) {
      <p
        data-testid="diff-totals"
        class="font-mono text-xs text-slate-600"
      >
        # {{ line }}
      </p>
    }
    @if (tabularView(); as t) {
      <table
        data-testid="tabular-diff"
        class="w-full border-collapse text-xs"
      >
        <thead>
          <tr class="border-b border-slate-300 text-left">
            <th class="px-2 py-1 font-semibold">side</th>
            <th class="px-2 py-1 font-semibold">count</th>
            @for (v of t.variables; track v) {
              <th class="px-2 py-1 font-semibold">{{ v }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (e of tabularRows(t); track $index) {
            <tr class="border-b border-slate-100">
              <td
                data-col="side"
                class="px-2 py-1 font-mono"
                [class.bg-red-50]="e.side === '-'"
                [class.bg-green-50]="e.side === '+'"
              >{{ e.side }}</td>
              <td data-col="count" class="px-2 py-1 font-mono">{{ e.entry.count }}</td>
              @for (v of t.variables; track v) {
                <td class="px-2 py-1 font-mono">{{ termText(e.entry.row[v]) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    }
    @if (graphView(); as g) {
      <section class="grid grid-cols-2 gap-4">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">removed</h2>
          <ul class="font-mono text-xs">
            @for (line of g.diff.removed; track $index) {
              <li class="flex flex-col gap-1">
                <span
                  data-testid="removed-line"
                  class="whitespace-pre rounded bg-red-50 px-1"
                >
                  {{ shorten(line) }}
                </span>
                @for (rec of recordsFor(g, 'left', line); track $index) {
                  @if (rec.line !== undefined) {
                    <app-source-snippet
                      [file]="rec.file"
                      [line]="rec.line"
                      [context]="context()"
                    />
                  }
                }
              </li>
            }
          </ul>
        </div>
        <div>
          <h2 class="text-sm font-semibold text-slate-700">added</h2>
          <ul class="font-mono text-xs">
            @for (line of g.diff.added; track $index) {
              <li class="flex flex-col gap-1">
                <span
                  data-testid="added-line"
                  class="whitespace-pre rounded bg-green-50 px-1"
                >
                  {{ shorten(line) }}
                </span>
                @for (rec of recordsFor(g, 'right', line); track $index) {
                  @if (rec.line !== undefined) {
                    <app-source-snippet
                      [file]="rec.file"
                      [line]="rec.line"
                      [context]="context()"
                    />
                  }
                }
              </li>
            }
          </ul>
        </div>
      </section>
    }
    @if (result().kind === 'error') {
      @let errs = errorView();
      @if (errs?.top) {
        <p
          data-testid="error-top"
          class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
        >
          {{ errs?.top }}
        </p>
      }
      <div class="grid grid-cols-2 gap-4">
        @if (errs?.left) {
          <p
            data-testid="error-left"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ errs?.left }}
          </p>
        }
        @if (errs?.right) {
          <p
            data-testid="error-right"
            class="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700"
          >
            {{ errs?.right }}
          </p>
        }
      </div>
    }
  `,
})
export class DiffResultRenderer {
  readonly result = input.required<DiffResponse>();
  readonly context = input<number>(3);

  readonly errorView = computed(() => {
    const r = this.result();
    return r.kind === 'error' ? r.errors : null;
  });

  readonly graphView = computed<GraphDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'graph' ? r : null;
  });

  readonly tabularView = computed<TabularDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'tabular' ? r : null;
  });

  readonly totalsLine = computed<string | null>(() => {
    const r = this.result();
    if (r.kind === 'graph') {
      return summaryLine(r.totals, r.diff.added.length, r.diff.removed.length);
    }
    if (r.kind === 'tabular') {
      return summaryLine(
        r.totals,
        r.diff.added.length,
        r.diff.removed.length,
      );
    }
    return null;
  });

  tabularRows(
    t: TabularDiffResponse,
  ): ReadonlyArray<{ side: '-' | '+'; entry: TabularDiffEntry }> {
    const removed = t.diff.removed.map((entry) => ({
      side: '-' as const,
      entry,
    }));
    const added = t.diff.added.map((entry) => ({ side: '+' as const, entry }));
    return [...removed, ...added];
  }

  termText(term: TabularTerm | undefined): string {
    if (!term) return '';
    if (term.termType === 'NamedNode') {
      return shortenNamedNode(term.value);
    }
    if (term.termType === 'BlankNode') return `_:${term.value}`;
    if (term.termType === 'Literal') {
      const lex = `"${term.value}"`;
      if (term.language) return `${lex}@${term.language}`;
      const dt = term.datatype?.value;
      if (
        dt &&
        dt !== 'http://www.w3.org/2001/XMLSchema#string' &&
        dt !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
      ) {
        return `${lex}^^${shortenNamedNode(dt)}`;
      }
      return lex;
    }
    return term.value;
  }

  shorten(line: string): string {
    return shortenNQuadLine(line, { prefixes: { ...DEFAULT_PREFIXES } });
  }

  recordsFor(
    g: GraphDiffResponse,
    side: 'left' | 'right',
    line: string,
  ): ReadonlyArray<SourceRecord> {
    return g.sourceRecords[side][line] ?? [];
  }
}

function summaryLine(
  totals: { left: number; right: number },
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}

function shortenNamedNode(iri: string): string {
  for (const [name, ns] of Object.entries(DEFAULT_PREFIXES)) {
    if (iri.startsWith(ns)) return `${name}:${iri.slice(ns.length)}`;
  }
  return `<${iri}>`;
}
