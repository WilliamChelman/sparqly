import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext } from './config.service';
import type { SelectResult } from './sparql-result-decoder';
import { TermCell } from './term-cell';

@Component({
  selector: 'app-result-table-select',
  standalone: true,
  imports: [ScrollingModule, TermCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="result-table-select"
      [attr.data-row-count]="rowCount()"
      class="results-table"
    >
      <div
        data-testid="select-header"
        data-sticky="true"
        class="results-table-head"
        [style.gridTemplateColumns]="gridTemplateColumns()"
      >
        <div
          data-testid="select-header-cell"
          class="results-table-rownum"
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
            class="results-table-row"
            [style.gridTemplateColumns]="gridTemplateColumns()"
          >
            <div class="results-table-rownum">{{ i + 1 }}</div>
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
export class ResultTableSelect {
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
    row: Record<string, import('./sparql-result-decoder').Term>,
    name: string,
  ): import('./sparql-result-decoder').Term | null {
    return row[name] ?? null;
  }
}
