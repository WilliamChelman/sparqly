import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DisplayContext } from '@app/core';
import type {
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  TabularDiffResponse,
} from '../services/diff.service';
import { classifyHunk } from '../utils/hunk-classifier';
import { DiffErrorViewComponent } from './diff-error-view.component';
import {
  DiffHunkSectionComponent,
  type ClassifiedHunk,
} from './diff-hunk-section.component';
import { DiffTabularTableComponent } from './diff-tabular-table.component';
import { DiffTotalsComponent } from './diff-totals.component';

@Component({
  selector: 'app-diff-result-renderer',
  standalone: true,
  imports: [
    DiffTotalsComponent,
    DiffTabularTableComponent,
    DiffHunkSectionComponent,
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
      <app-diff-hunk-section
        testid="section-changed"
        title="Changed"
        [hunks]="changedHunks()"
        [context]="context()"
        [displayContext]="displayContext()"
      />
      <app-diff-hunk-section
        testid="section-added"
        title="Added"
        [hunks]="addedHunks()"
        [context]="context()"
        [displayContext]="displayContext()"
      />
      <app-diff-hunk-section
        testid="section-removed"
        title="Removed"
        [hunks]="removedHunks()"
        [context]="context()"
        [displayContext]="displayContext()"
      />
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

  private readonly classifiedHunks = computed<ReadonlyArray<ClassifiedHunk>>(() => {
    const g = this.groupedView();
    if (g === null) return [];
    const all: Hunk[] = [...g.hunked.changed, ...g.hunked.added, ...g.hunked.removed];
    return all.map((hunk) => ({ hunk, cls: classifyHunk(hunk) }));
  });

  readonly changedHunks = computed<ReadonlyArray<ClassifiedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'changed'),
  );
  readonly addedHunks = computed<ReadonlyArray<ClassifiedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'added'),
  );
  readonly removedHunks = computed<ReadonlyArray<ClassifiedHunk>>(() =>
    this.classifiedHunks().filter((rh) => rh.cls === 'removed'),
  );

  readonly totalsLine = computed<string | null>(() => {
    const r = this.result();
    if (r.kind === 'grouped') {
      const totals = r.hunked.totals;
      let added = 0;
      let removed = 0;
      for (const h of [
        ...r.hunked.changed,
        ...r.hunked.added,
        ...r.hunked.removed,
      ]) {
        added += h.added;
        removed += h.removed;
      }
      return summaryLine(totals, added, removed);
    }
    if (r.kind === 'tabular') {
      return summaryLine(r.totals, r.diff.added.length, r.diff.removed.length);
    }
    return null;
  });
}

function summaryLine(
  totals: { left: number; right: number },
  added: number,
  removed: number,
): string {
  return `left=${totals.left} right=${totals.right} +${added} -${removed}`;
}
