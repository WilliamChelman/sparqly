import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext, TripleResult } from '@app/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { TermCellComponent } from './term-cell.component';

@Component({
  selector: 'app-result-table-triples',
  standalone: true,
  imports: [EyebrowComponent, ScrollingModule, TermCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full font-mono text-xs">
      <div
        app-eyebrow
        data-sticky="true"
        class="sticky top-0 z-[1] grid border-b border-border bg-surface-sunken font-sans [&>div]:px-3.5 [&>div]:py-2"
        style="grid-template-columns: 48px minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr)"
      >
        <div class="select-none text-right text-foreground-faint">#</div>
        <div>subject</div>
        <div>predicate</div>
        <div>object</div>
      </div>
      @if (rowCount() === 0) {
        <p
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
            class="grid border-b border-border-muted transition-colors duration-[120ms] hover:bg-row-hover [&>div]:overflow-hidden [&>div]:text-ellipsis [&>div]:whitespace-nowrap [&>div]:px-3.5 [&>div]:py-2"
            style="grid-template-columns: 48px minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 1fr)"
          >
            <div class="select-none text-right text-foreground-faint">{{ i + 1 }}</div>
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
