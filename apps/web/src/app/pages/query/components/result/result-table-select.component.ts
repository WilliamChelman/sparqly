import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext, SelectResult, Term } from '@app/core';
import { TermCellComponent } from './term-cell.component';

@Component({
  selector: 'app-result-table-select',
  standalone: true,
  imports: [ScrollingModule, TermCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="result-table-select"
      [attr.data-row-count]="rowCount()"
      class="w-full font-mono text-xs"
    >
      <div
        data-testid="select-header"
        data-sticky="true"
        class="sticky top-0 z-[1] grid border-b border-border bg-surface-sunken font-sans text-[10px] uppercase tracking-[0.14em] text-foreground-faint [&>div]:px-3.5 [&>div]:py-2"
        [style.gridTemplateColumns]="gridTemplateColumns()"
      >
        <div
          data-testid="select-header-cell"
          class="select-none text-right text-foreground-faint"
        >#</div>
        @for (v of variables(); track v) {
          <div data-testid="select-header-cell">?{{ v }}</div>
        }
      </div>
      @if (rowCount() === 0) {
        <p
          data-testid="select-empty"
          class="px-3.5 py-3 font-mono text-xs italic text-foreground-faint"
        >no results</p>
      } @else {
        <cdk-virtual-scroll-viewport
          itemSize="36"
          class="w-full"
          [style.height]="viewportHeight()"
        >
          <div
            *cdkVirtualFor="let row of bindings(); trackBy: trackByIndex; let i = index"
            data-testid="select-row"
            class="grid border-b border-border-muted transition-colors duration-[120ms] hover:bg-row-hover [&>div]:overflow-hidden [&>div]:text-ellipsis [&>div]:whitespace-nowrap [&>div]:px-3.5 [&>div]:py-2"
            [style.gridTemplateColumns]="gridTemplateColumns()"
          >
            <div class="select-none text-right text-foreground-faint">{{ i + 1 }}</div>
            @for (v of variables(); track v) {
              <div>
                <app-term-cell [term]="cellTerm(row, v)" [context]="context()" />
              </div>
            }
          </div>
        </cdk-virtual-scroll-viewport>
      }
    </div>
  `,
})
export class ResultTableSelectComponent {
  readonly result = input.required<SelectResult>();
  readonly context = input<DisplayContext>({ prefixes: {} });

  readonly variables = computed(() => this.result().variables);
  readonly bindings = computed(() => this.result().bindings);
  readonly rowCount = computed(() => this.bindings().length);
  readonly gridTemplateColumns = computed(() => {
    const cols = this.variables()
      .map(() => 'minmax(140px, 1fr)')
      .join(' ');
    return `48px ${cols}`;
  });
  readonly viewportHeight = computed(() => {
    const rows = this.rowCount();
    if (rows <= 12) return `${rows * 36 + 4}px`;
    return '60vh';
  });

  trackByIndex(i: number): number {
    return i;
  }

  cellTerm(
    row: Record<string, Term>,
    name: string,
  ): Term | null {
    return row[name] ?? null;
  }
}
