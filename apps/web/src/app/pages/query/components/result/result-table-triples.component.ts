import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext, TripleResult } from '@app/core';
import { TermCellComponent } from './term-cell.component';

@Component({
  selector: 'app-result-table-triples',
  standalone: true,
  imports: [ScrollingModule, TermCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="result-table-triples"
      [attr.data-row-count]="rowCount()"
      class="results-table"
    >
      <div
        data-testid="triples-header"
        data-sticky="true"
        class="results-table-head"
        style="grid-template-columns: 48px minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr)"
      >
        <div data-testid="triples-header-cell" class="results-table-rownum">#</div>
        <div data-testid="triples-header-cell">subject</div>
        <div data-testid="triples-header-cell">predicate</div>
        <div data-testid="triples-header-cell">object</div>
      </div>
      @if (rowCount() === 0) {
        <p
          data-testid="triples-empty"
          class="px-3.5 py-3 font-mono text-xs italic text-foreground-faint"
        >no triples</p>
      } @else {
        <cdk-virtual-scroll-viewport
          itemSize="36"
          class="w-full"
          [style.height]="viewportHeight()"
        >
          <div
            *cdkVirtualFor="let t of triples(); trackBy: trackByIndex; let i = index"
            data-testid="triples-row"
            class="results-table-row"
            style="grid-template-columns: 48px minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr)"
          >
            <div class="results-table-rownum">{{ i + 1 }}</div>
            <div>
              <app-term-cell [term]="t.subject" [context]="context()" />
            </div>
            <div>
              <app-term-cell [term]="t.predicate" [context]="context()" />
            </div>
            <div>
              <app-term-cell [term]="t.object" [context]="context()" />
            </div>
          </div>
        </cdk-virtual-scroll-viewport>
      }
    </div>
  `,
})
export class ResultTableTriplesComponent {
  readonly result = input.required<TripleResult>();
  readonly context = input<DisplayContext>({ prefixes: {} });

  readonly triples = computed(() => this.result().triples);
  readonly rowCount = computed(() => this.triples().length);
  readonly viewportHeight = computed(() => {
    const rows = this.rowCount();
    if (rows <= 12) return `${rows * 36 + 4}px`;
    return '60vh';
  });

  trackByIndex(i: number): number {
    return i;
  }
}
