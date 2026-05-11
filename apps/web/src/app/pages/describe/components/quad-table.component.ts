import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Quad, Term } from 'n3';
import { describeProvenance, parseDescribeWire } from 'common';
import { DescribeLinkComponent } from '@app/modules/describe-link';

interface DisplayRow {
  s: string;
  sIri: string | null;
  p: string;
  pIri: string | null;
  o: string;
  oIri: string | null;
  g: string;
  origins: string[];
}

interface DisplayGroup {
  subject: string;
  isSeed: boolean;
  rows: DisplayRow[];
}

const DEFAULT_FROM_SOURCE_PREDICATE = 'urn:sparqly:fromSource';

function termLabel(term: Term): string {
  if (term.termType === 'NamedNode') return term.value;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') return `"${term.value}"`;
  if (term.termType === 'DefaultGraph') return '';
  return term.value;
}

function iriOf(term: Term): string | null {
  return term.termType === 'NamedNode' ? term.value : null;
}

function quadKey(q: Quad): string {
  return `${termKey(q.subject)} ${termKey(q.predicate)} ${termKey(q.object)} ${termKey(q.graph)}`;
}

function termKey(t: Term): string {
  if ((t.termType as string) === 'Quad') {
    return `<<${quadKey(t as unknown as Quad)}>>`;
  }
  return `${t.termType}:${t.value}`;
}

@Component({
  selector: 'app-quad-table',
  standalone: true,
  imports: [DescribeLinkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (groups().length === 0) {
      <p data-testid="empty-quad-table" class="p-4 text-sm text-foreground-faint">
        No quads.
      </p>
    } @else {
      <table
        data-testid="quad-table"
        class="w-full border-collapse text-left font-mono text-sm"
      >
        <thead class="bg-surface-sunken text-foreground-muted">
          <tr>
            <th class="border border-border-muted px-2 py-1">s</th>
            <th class="border border-border-muted px-2 py-1">p</th>
            <th class="border border-border-muted px-2 py-1">o</th>
            <th class="border border-border-muted px-2 py-1">g</th>
            <th class="border border-border-muted px-2 py-1">from</th>
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.subject) {
            @for (row of group.rows; track $index) {
              <tr
                [attr.data-group-subject]="group.subject"
                [attr.data-is-seed-group]="group.isSeed ? 'true' : 'false'"
              >
                <td class="border border-border-muted px-2 py-1"
                  >{{ row.s }}@if (row.sIri; as iri) {<app-describe-link [iri]="iri" />}</td>
                <td class="border border-border-muted px-2 py-1"
                  >{{ row.p }}@if (row.pIri; as iri) {<app-describe-link [iri]="iri" />}</td>
                <td class="border border-border-muted px-2 py-1"
                  >{{ row.o }}@if (row.oIri; as iri) {<app-describe-link [iri]="iri" />}</td>
                <td class="border border-border-muted px-2 py-1">{{ row.g }}</td>
                <td class="border border-border-muted px-2 py-1">
                  @for (origin of row.origins; track origin) {
                    <span
                      data-testid="source-badge"
                      class="mr-1 inline-block rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted"
                    >{{ origin }}</span>
                  }
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    }
  `,
})
export class QuadTableComponent {
  readonly quadsText = input<string>('');
  readonly seed = input<string>('');
  readonly fromSourcePredicate = input<string>(DEFAULT_FROM_SOURCE_PREDICATE);

  readonly groups = computed<DisplayGroup[]>(() => {
    const text = this.quadsText();
    const seed = this.seed();
    const predicate = this.fromSourcePredicate();
    const all = text.trim().length === 0 ? [] : parseDescribeWire(text);
    const { quads, originsByQuad } = describeProvenance.strip(all, predicate);
    const bySubject = new Map<string, DisplayRow[]>();
    for (const q of quads) {
      const s = termLabel(q.subject);
      const row: DisplayRow = {
        s,
        sIri: iriOf(q.subject),
        p: termLabel(q.predicate),
        pIri: iriOf(q.predicate),
        o: termLabel(q.object),
        oIri: iriOf(q.object),
        g: termLabel(q.graph),
        origins: originsByQuad.get(quadKey(q)) ?? [],
      };
      const list = bySubject.get(s);
      if (list) list.push(row);
      else bySubject.set(s, [row]);
    }
    const groups: DisplayGroup[] = [...bySubject.entries()].map(
      ([subject, rows]) => ({
        subject,
        isSeed: subject === seed,
        rows,
      }),
    );
    groups.sort((a, b) => {
      if (a.isSeed && !b.isSeed) return -1;
      if (!a.isSeed && b.isSeed) return 1;
      return a.subject.localeCompare(b.subject);
    });
    return groups;
  });
}
