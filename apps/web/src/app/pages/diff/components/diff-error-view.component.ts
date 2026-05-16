import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ErrorBannerComponent } from '@app/modules/error-banner';
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
  imports: [ErrorBannerComponent],
  template: `
    @let errs = errors();
    @if (errs.top; as top) {
      <p app-error-banner size="md" data-testid="error-top">{{ format(top) }}</p>
    }
    <div class="grid grid-cols-2 gap-4">
      @if (errs.left; as left) {
        <p app-error-banner size="md" data-testid="error-left">{{ format(left) }}</p>
      }
      @if (errs.right; as right) {
        <p app-error-banner size="md" data-testid="error-right">{{ format(right) }}</p>
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
