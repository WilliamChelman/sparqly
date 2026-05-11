import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DEFAULT_PREFIXES } from 'common';
import type { DisplayContext } from '@app/core';
import { DescribeLinkComponent } from '@app/modules/describe-link';
import type {
  TabularDiffEntry,
  TabularDiffResponse,
  TabularTerm,
} from '../services/diff.service';
import { curieOrIri } from '../utils/term-display';

interface TabularRow {
  readonly side: '-' | '+';
  readonly entry: TabularDiffEntry;
}

@Component({
  selector: 'app-diff-tabular-table',
  standalone: true,
  imports: [DescribeLinkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="overflow-hidden rounded-lg border border-border-muted bg-surface"
    >
      <table
        data-testid="tabular-diff"
        class="w-full border-collapse font-mono text-xs [&_td]:border-b [&_td]:border-border-muted [&_td]:px-3 [&_td]:py-[7px] [&_td]:text-left [&_th]:border-b [&_th]:border-border-muted [&_th]:px-3 [&_th]:py-[7px] [&_th]:text-left [&_thead_th]:bg-surface-sunken [&_thead_th]:font-sans [&_thead_th]:text-[10px] [&_thead_th]:uppercase [&_thead_th]:tracking-[0.14em] [&_thead_th]:text-foreground-faint"
      >
        <thead>
          <tr>
            <th class="w-[26px] text-center">side</th>
            <th>count</th>
            @for (v of result().variables; track v) {
              <th>{{ v }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (e of rows(); track $index) {
            <tr
              [attr.data-side]="e.side"
              [class.bg-added-bg]="e.side === '+'"
              [class.bg-removed-bg]="e.side === '-'"
            >
              <td
                class="w-[26px] text-center font-semibold"
                [class.text-accent-strong]="e.side === '+'"
                [class.dark:text-accent]="e.side === '+'"
                [class.text-secondary-strong]="e.side === '-'"
                [class.dark:text-secondary]="e.side === '-'"
              >{{ e.side === '+' ? '✦' : '✧' }}</td>
              <td>{{ e.entry.count }}</td>
              @for (v of result().variables; track v) {
                @let term = e.entry.row[v];
                <td
                  >{{ termText(term) }}@if (iriOf(term); as iri) {<app-describe-link [iri]="iri" />}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DiffTabularTableComponent {
  readonly result = input.required<TabularDiffResponse>();
  readonly displayContext = input<DisplayContext>({ prefixes: {} });

  readonly rows = computed<ReadonlyArray<TabularRow>>(() => {
    const r = this.result();
    const removed = r.diff.removed.map((entry) => ({ side: '-' as const, entry }));
    const added = r.diff.added.map((entry) => ({ side: '+' as const, entry }));
    return [...added, ...removed];
  });

  private readonly prefixEntries = computed<ReadonlyArray<[string, string]>>(
    () =>
      Object.entries({ ...DEFAULT_PREFIXES, ...this.displayContext().prefixes }),
  );

  iriOf(term: TabularTerm | undefined): string | null {
    return term?.termType === 'NamedNode' ? term.value : null;
  }

  termText(term: TabularTerm | undefined): string {
    if (!term) return '';
    const entries = this.prefixEntries();
    const base = this.displayContext().base;
    if (term.termType === 'NamedNode') {
      return curieOrIri(term.value, entries, base);
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
        return `${lex}^^${curieOrIri(dt, entries, base)}`;
      }
      return lex;
    }
    return term.value;
  }
}
