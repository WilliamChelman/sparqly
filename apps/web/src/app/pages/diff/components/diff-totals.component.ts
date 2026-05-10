import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-diff-totals',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p
      data-testid="diff-totals"
      class="flex flex-wrap items-center gap-3.5 rounded-lg border border-border-muted bg-surface-sunken px-[18px] py-3 font-mono text-xs text-foreground-muted"
    >
      <span class="inline-flex items-center gap-1.5 text-foreground-faint">
        <span class="text-accent">✦</span>
        <span>───</span>
        <span class="text-secondary">✧</span>
      </span>
      {{ line() }}
    </p>
  `,
})
export class DiffTotalsComponent {
  readonly line = input.required<string>();
}
