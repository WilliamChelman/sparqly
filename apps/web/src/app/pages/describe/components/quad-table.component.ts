import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Parser, type Quad, type Term } from 'n3';

interface DisplayRow {
  s: string;
  p: string;
  o: string;
  g: string;
}

interface DisplayGroup {
  subject: string;
  isSeed: boolean;
  rows: DisplayRow[];
}

function termLabel(term: Term): string {
  if (term.termType === 'NamedNode') return term.value;
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  if (term.termType === 'Literal') return `"${term.value}"`;
  if (term.termType === 'DefaultGraph') return '';
  return term.value;
}

function parseNQuads(body: string): Quad[] {
  if (body.trim().length === 0) return [];
  const parser = new Parser({ format: 'application/n-quads' });
  return parser.parse(body) as Quad[];
}

@Component({
  selector: 'app-quad-table',
  standalone: true,
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
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.subject) {
            @for (row of group.rows; track $index) {
              <tr
                [attr.data-group-subject]="group.subject"
                [attr.data-is-seed-group]="group.isSeed ? 'true' : 'false'"
              >
                <td class="border border-border-muted px-2 py-1">{{ row.s }}</td>
                <td class="border border-border-muted px-2 py-1">{{ row.p }}</td>
                <td class="border border-border-muted px-2 py-1">{{ row.o }}</td>
                <td class="border border-border-muted px-2 py-1">{{ row.g }}</td>
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

  readonly groups = computed<DisplayGroup[]>(() => {
    const quads = parseNQuads(this.quadsText());
    const seed = this.seed();
    const bySubject = new Map<string, DisplayRow[]>();
    for (const q of quads) {
      const s = termLabel(q.subject);
      const row: DisplayRow = {
        s,
        p: termLabel(q.predicate),
        o: termLabel(q.object),
        g: termLabel(q.graph),
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
