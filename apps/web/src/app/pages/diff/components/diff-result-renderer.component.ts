import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DisplayContext } from '@app/core';
import type {
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  TabularDiffResponse,
} from '../models/diff-response';
import { classifyHunk, type HunkClass } from '../utils/hunk-classifier';
import { computeTotalsLine } from '../utils/totals-line';
import { DiffErrorViewComponent } from './diff-error-view.component';
import { DiffHunkComponent } from './diff-hunk.component';
import { DiffTabularTableComponent } from './diff-tabular-table.component';
import { DiffTotalsComponent } from './diff-totals.component';

interface ClassifiedHunk {
  readonly hunk: Hunk;
  readonly cls: HunkClass;
}

@Component({
  selector: 'app-diff-result-renderer',
  standalone: true,
  imports: [
    DiffTotalsComponent,
    DiffTabularTableComponent,
    DiffHunkComponent,
    DiffErrorViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalsLine(); as line) {
      <app-diff-totals [line]="line" />
    }
    @if (tabularView(); as t) {
      <app-diff-tabular-table [result]="t" [displayContext]="displayContext()" />
    }
    @if (groupedView()) {
      <div class="mt-2 flex flex-col">
        @if (classifiedHunks().length === 0) {
          <p
            class="my-2 font-serif text-sm italic text-foreground-faint"
          >(no changes)</p>
        }
        @for (rh of classifiedHunks(); track rh.hunk.anchor) {
          <app-diff-hunk
            [hunk]="rh.hunk"
            [cls]="rh.cls"
            [context]="context()"
            [displayContext]="displayContext()"
          />
        }
      </div>
    }
    @if (errorView(); as errs) {
      <app-diff-error-view [errors]="errs" />
    }
  `,
})
export class DiffResultRendererComponent {
  readonly result = input.required<DiffResponse>();
  readonly context = input<number>(3);
  readonly displayContext = input<DisplayContext>({ prefixes: {} });

  readonly errorView = computed(() => {
    const r = this.result();
    return r.kind === 'error' ? r.errors : null;
  });

  readonly groupedView = computed<GroupedDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'grouped' ? r : null;
  });

  readonly tabularView = computed<TabularDiffResponse | null>(() => {
    const r = this.result();
    return r.kind === 'tabular' ? r : null;
  });

  readonly classifiedHunks = computed<ReadonlyArray<ClassifiedHunk>>(() => {
    const g = this.groupedView();
    if (g === null) return [];
    return g.hunked.hunks.map((hunk) => ({ hunk, cls: classifyHunk(hunk) }));
  });

  readonly totalsLine = computed<string | null>(() => computeTotalsLine(this.result()));
}
