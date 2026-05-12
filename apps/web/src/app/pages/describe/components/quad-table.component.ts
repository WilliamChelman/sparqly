import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { Quad, Term } from 'n3';
import { describeProvenance, parseDescribeWire } from 'common';
import type { DisplayContext, Term as CoreTerm } from '@app/core';
import { TermCellComponent } from '@app/pages/query/components/result/term-cell.component';
import {
  describeBnodePath,
  isExpandableBnode,
  MAX_EXPANSION_PATH_STEPS,
  type DescribeBnodePathResult,
} from '../utils/describe-bnode-path';

interface DisplayRow {
  s: CoreTerm;
  p: CoreTerm;
  o: CoreTerm;
  // Only present for named/blank graphs — the default graph renders as nothing.
  g: CoreTerm | null;
  origins: string[];
  // Set when `o` is a dangling, endpoint-origin blank node within the step cap —
  // the in-place expand affordance (ADR-0019).
  expand: DescribeBnodePathResult | null;
}

interface DisplayGroup {
  subject: string;
  isSeed: boolean;
  rows: DisplayRow[];
}

const DEFAULT_FROM_SOURCE_PREDICATE = 'urn:sparqly:fromSource';

// Wire terms are always NamedNode/BlankNode/Literal; n3's broader type only
// matters for SPARQL Variables, which never appear in describe results.
function asCoreTerm(t: Term): CoreTerm {
  return t as unknown as CoreTerm;
}

function subjectKey(term: Term): string {
  if (term.termType === 'BlankNode') return `_:${term.value}`;
  return term.value;
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

function expandTargetFor(
  object: Term,
  quads: ReadonlyArray<Quad>,
  seed: string,
  endpointIds: ReadonlySet<string>,
): DescribeBnodePathResult | null {
  if (object.termType !== 'BlankNode') return null;
  if (!isExpandableBnode(quads, object.value, endpointIds)) return null;
  const found = describeBnodePath(quads, object.value, seed);
  if (found === null || found.path.length > MAX_EXPANSION_PATH_STEPS) return null;
  return found;
}

@Component({
  selector: 'app-quad-table',
  standalone: true,
  imports: [TermCellComponent],
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
                <td class="border border-border-muted px-2 py-1">
                  <app-term-cell [term]="row.s" [context]="context()" />
                </td>
                <td class="border border-border-muted px-2 py-1">
                  <app-term-cell [term]="row.p" [context]="context()" />
                </td>
                <td class="border border-border-muted px-2 py-1">
                  <app-term-cell [term]="row.o" [context]="context()" />
                  @if (row.expand; as ex) {
                    <button
                      data-testid="expand-bnode"
                      type="button"
                      title="Expand this blank node one hop deeper"
                      class="ml-1.5 cursor-pointer rounded border border-border bg-surface-sunken px-1 py-0.5 text-[10px] font-medium text-foreground-muted transition-colors hover:bg-surface hover:text-foreground"
                      (click)="expand.emit(ex)"
                    >⤵ expand</button>
                  }
                </td>
                <td class="border border-border-muted px-2 py-1">
                  @if (row.g; as g) {
                    <app-term-cell [term]="g" [context]="context()" [linkable]="false" />
                  }
                </td>
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
  readonly context = input<DisplayContext>({ prefixes: {} });
  /** Ids of `endpoint` sources — only their dangling bnodes get an expand affordance. */
  readonly endpointSourceIds = input<readonly string[]>([]);
  readonly expand = output<DescribeBnodePathResult>();

  readonly groups = computed<DisplayGroup[]>(() => {
    const text = this.quadsText();
    const seed = this.seed();
    const predicate = this.fromSourcePredicate();
    const endpointIds = new Set(this.endpointSourceIds());
    const all = text.trim().length === 0 ? [] : parseDescribeWire(text);
    const { quads, originsByQuad } = describeProvenance.strip(all, predicate);
    const bySubject = new Map<string, DisplayRow[]>();
    for (const q of quads) {
      const key = subjectKey(q.subject);
      const row: DisplayRow = {
        s: asCoreTerm(q.subject),
        p: asCoreTerm(q.predicate),
        o: asCoreTerm(q.object),
        g: q.graph.termType === 'DefaultGraph' ? null : asCoreTerm(q.graph),
        origins: originsByQuad.get(quadKey(q)) ?? [],
        expand: expandTargetFor(q.object, quads, seed, endpointIds),
      };
      const list = bySubject.get(key);
      if (list) list.push(row);
      else bySubject.set(key, [row]);
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
