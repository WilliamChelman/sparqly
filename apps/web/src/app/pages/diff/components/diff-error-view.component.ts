import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface DiffErrors {
  readonly top?: string;
  readonly left?: string;
  readonly right?: string;
}

@Component({
  selector: 'app-diff-error-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let errs = errors();
    @if (errs.top) {
      <p
        data-testid="error-top"
        class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
      >{{ errs.top }}</p>
    }
    <div class="grid grid-cols-2 gap-4">
      @if (errs.left) {
        <p
          data-testid="error-left"
          class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
        >{{ errs.left }}</p>
      }
      @if (errs.right) {
        <p
          data-testid="error-right"
          class="flex items-start gap-2.5 rounded-lg border border-error-line bg-error-bg px-3.5 py-3 font-mono text-xs text-error"
        >{{ errs.right }}</p>
      }
    </div>
  `,
})
export class DiffErrorViewComponent {
  readonly errors = input.required<DiffErrors>();
}
