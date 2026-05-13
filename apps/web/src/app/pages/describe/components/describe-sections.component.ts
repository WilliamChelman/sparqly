import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { Quad } from 'n3';
import type { DisplayContext } from '@app/core';
import { TermCellComponent } from '@app/pages/query/components/result/term-cell.component';
import {
  buildDescribeSections,
  type DescribeSections,
} from '../utils/describe-sections';
import type { DescribeBnodePathResult } from '../utils/describe-bnode-path';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

@Component({
  selector: 'app-describe-sections',
  standalone: true,
  imports: [TermCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let view = sections();
    @if (view.outbound.count === 0 && view.inbound.count === 0) {
      <p data-testid="empty-quad-table" class="p-4 text-sm text-foreground-faint">
        No quads.
      </p>
    } @else {
      @if (view.outbound.count > 0) {
        <section
          data-testid="describe-section"
          data-direction="outbound"
          class="flex flex-col gap-2 border-b border-border-muted py-3"
        >
          <h2 class="font-mono text-xs uppercase tracking-[0.14em] text-foreground-faint">
            outbound ·
            <span data-testid="describe-section-count">{{ view.outbound.count }}</span>
          </h2>
          @for (g of view.outbound.predicateGroups; track g.predicate) {
            <div
              data-testid="predicate-group"
              [attr.data-predicate]="g.predicate"
              class="ml-2 flex flex-col gap-1"
            >
              <div class="font-mono text-sm">
                @if (g.predicate === rdfType) {
                  <span class="text-secondary dark:text-secondary-soft">a</span>
                } @else {
                  <app-term-cell [term]="g.predicateTerm" [context]="context()" />
                }
              </div>
              <ul class="ml-4 flex flex-col gap-0.5">
                @for (m of g.members; track $index) {
                  <li
                    data-testid="describe-row"
                    class="flex flex-wrap items-baseline gap-1 font-mono text-sm"
                  >
                    @if (m.term.termType === 'BlankNode') {
                      <span class="italic text-foreground-muted">_:{{ m.term.value }}</span>
                    } @else {
                      <app-term-cell [term]="m.term" [context]="context()" />
                    }
                    @if (m.graph; as g2) {
                      <app-term-cell [term]="g2" [context]="context()" [linkable]="false" />
                    }
                    @for (origin of m.origins; track origin) {
                      <span
                        data-testid="source-badge"
                        class="ml-0.5 inline-block rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted"
                      >{{ origin }}</span>
                    }
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      }
      @if (view.inbound.count > 0) {
        <section
          data-testid="describe-section"
          data-direction="inbound"
          class="flex flex-col gap-2 py-3"
        >
          <h2 class="font-mono text-xs uppercase tracking-[0.14em] text-foreground-faint">
            inbound ·
            <span data-testid="describe-section-count">{{ view.inbound.count }}</span>
          </h2>
          @for (g of view.inbound.predicateGroups; track g.predicate) {
            <div
              data-testid="predicate-group"
              [attr.data-predicate]="g.predicate"
              class="ml-2 flex flex-col gap-1"
            >
              <div class="font-mono text-sm">
                <span class="text-foreground-faint">←</span>
                <app-term-cell [term]="g.predicateTerm" [context]="context()" />
              </div>
              <ul class="ml-4 flex flex-col gap-0.5">
                @for (m of g.members; track $index) {
                  <li
                    data-testid="describe-row"
                    class="flex flex-wrap items-baseline gap-1 font-mono text-sm"
                  >
                    @if (m.term.termType === 'BlankNode') {
                      <span class="italic text-foreground-muted">_:{{ m.term.value }}</span>
                    } @else {
                      <app-term-cell [term]="m.term" [context]="context()" />
                    }
                    @if (m.graph; as g2) {
                      <app-term-cell [term]="g2" [context]="context()" [linkable]="false" />
                    }
                    @for (origin of m.origins; track origin) {
                      <span
                        data-testid="source-badge"
                        class="ml-0.5 inline-block rounded-md border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted"
                      >{{ origin }}</span>
                    }
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      }
    }
  `,
})
export class DescribeSectionsComponent {
  readonly quads = input<ReadonlyArray<Quad>>([]);
  readonly originsByQuad = input<ReadonlyMap<string, readonly string[]>>(new Map());
  readonly seed = input<string>('');
  readonly context = input<DisplayContext>({ prefixes: {} });
  /** Ids of `endpoint` sources — wired through for the follow-up `⤵ expand` slice. */
  readonly endpointSourceIds = input<readonly string[]>([]);
  /** Wired for the follow-up slice; not emitted in v1. */
  readonly expand = output<DescribeBnodePathResult>();

  readonly rdfType = RDF_TYPE;

  readonly sections = computed<DescribeSections>(() =>
    buildDescribeSections(
      this.quads(),
      this.originsByQuad(),
      this.seed(),
      new Set(this.endpointSourceIds()),
    ),
  );

}
