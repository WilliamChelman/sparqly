import { CdkTableModule } from '@angular/cdk/table';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
} from '@angular/core';
import type { DisplayContext, SelectResult, Term } from '@app/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { startColumnResize } from './column-resize';
import { TermCellComponent } from './term-cell.component';

const ROW_NUM_COLUMN = '__rowNum';

@Component({
  selector: 'app-result-table-select',
  standalone: true,
  imports: [CdkTableModule, EyebrowComponent, TermCellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rowCount() === 0) {
      <p
        class="px-3.5 py-3 font-mono text-xs italic text-foreground-faint"
      >no results</p>
    } @else {
      <div
        class="w-full overflow-auto"
        [style.max-height]="hasOverflow() ? '60vh' : null"
      >
        <table
          cdk-table
          [dataSource]="bindings()"
          class="w-full table-fixed border-collapse font-mono text-xs"
        >
          <ng-container cdkColumnDef="__rowNum">
            <th
              cdk-header-cell
              *cdkHeaderCellDef
              app-eyebrow
              scope="col"
              class="select-none border-b border-border bg-surface-sunken px-3.5 py-2 text-right font-sans font-normal"
              style="width: 48px"
            >#</th>
            <td
              cdk-cell
              *cdkCellDef="let row; let i = index"
              class="select-none overflow-hidden px-3.5 py-2 text-right text-foreground-faint"
            >{{ i + 1 }}</td>
          </ng-container>

          @for (v of variables(); track v; let colIdx = $index) {
            <ng-container [cdkColumnDef]="v">
              <th
                cdk-header-cell
                *cdkHeaderCellDef
                app-eyebrow
                scope="col"
                class="relative border-b border-border bg-surface-sunken px-3.5 py-2 text-left font-sans font-normal"
                [style.width.px]="widths()[colIdx]"
              >?{{ v }}<div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize column"
                  class="absolute right-0 top-0 z-[1] h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-accent active:bg-accent"
                  (pointerdown)="onResize($event, colIdx)"
                ></div></th>
              <td
                cdk-cell
                *cdkCellDef="let row"
                class="overflow-hidden px-3.5 py-2"
              >
                <app-term-cell [term]="cellTerm(row, v)" [context]="context()" [source]="source()" />
              </td>
            </ng-container>
          }

          <tr cdk-header-row *cdkHeaderRowDef="displayedColumns(); sticky: true"></tr>
          <tr
            cdk-row
            *cdkRowDef="let row; columns: displayedColumns()"
            class="border-b border-border-muted transition-colors duration-[120ms] hover:bg-row-hover"
          ></tr>
        </table>
      </div>
    }
  `,
})
export class ResultTableSelectComponent {
  readonly result = input.required<SelectResult>();
  readonly context = input<DisplayContext>({ prefixes: {} });
  readonly source = input<string | undefined>(undefined);

  readonly variables = computed(() => this.result().variables);
  readonly bindings = computed(() => this.result().bindings);
  readonly rowCount = computed(() => this.bindings().length);
  readonly hasOverflow = computed(() => this.rowCount() > 12);

  readonly displayedColumns = computed(() => [
    ROW_NUM_COLUMN,
    ...this.variables(),
  ]);

  readonly widths = linkedSignal<readonly string[], (number | null)[]>({
    source: this.variables,
    computation: (vars) => vars.map(() => null as number | null),
  });

  onResize(event: PointerEvent, columnIndex: number): void {
    startColumnResize(event, columnIndex, (i, w) => {
      this.widths.update((ws) => {
        const next = [...ws];
        next[i] = w;
        return next;
      });
    });
  }

  cellTerm(
    row: Record<string, Term>,
    name: string,
  ): Term | null {
    return row[name] ?? null;
  }
}
