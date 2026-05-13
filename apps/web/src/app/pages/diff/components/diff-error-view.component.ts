import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  formatDiffError,
  type DiffError,
} from '../services/diff.service';

export interface DiffErrors {
  readonly top?: DiffError;
  readonly left?: DiffError;
  readonly right?: DiffError;
}

@Component({
  selector: 'app-diff-error-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let errs = errors();
    @if (errs.top; as top) {
      <p
        data-testid="error-top"
        class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
      >{{ format(top) }}</p>
    }
    <div class="grid grid-cols-2 gap-4">
      @if (errs.left; as left) {
        <p
          data-testid="error-left"
          class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
        >{{ format(left) }}</p>
      }
      @if (errs.right; as right) {
        <p
          data-testid="error-right"
          class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
        >{{ format(right) }}</p>
      }
    </div>
  `,
})
export class DiffErrorViewComponent {
  readonly errors = input.required<DiffErrors>();

  format(error: DiffError): string {
    return formatDiffError(error);
  }
}
