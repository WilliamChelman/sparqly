import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DescribePerSourceEntry } from '../services/describe.service';

interface SourceErrorRow {
  id: string;
  message: string;
}

/**
 * Renders the per-source failures from a `/api/describe` response inline under
 * the source picker. `/api/describe` is best-effort: a source can fail while
 * others succeed, so these rows sit alongside (not instead of) the quad table.
 * Styled with the `error` palette so they read distinctly from the neutral
 * per-row source badges in the quad table.
 */
@Component({
  selector: 'app-source-errors',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <ul
        data-testid="source-errors"
        class="flex flex-col gap-1 rounded border border-error-line bg-error-bg p-2 text-sm text-error"
      >
        @for (row of rows(); track row.id) {
          <li data-testid="source-error-row" class="font-mono text-xs">
            <span class="font-semibold">{{ row.id }}</span>
            <span class="opacity-80"> — {{ row.message }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class SourceErrorsComponent {
  readonly perSource = input<Record<string, DescribePerSourceEntry>>({});

  readonly rows = computed<SourceErrorRow[]>(() =>
    Object.entries(this.perSource())
      .filter(([, e]) => e.error !== undefined && e.error.length > 0)
      .map(([id, e]) => ({ id, message: e.error as string }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
