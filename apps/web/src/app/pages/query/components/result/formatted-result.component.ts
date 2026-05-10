import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { FormatSerialization } from 'common';

@Component({
  selector: 'app-formatted-result',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="result-formatted"
      [attr.data-serialization]="serialization()"
    >
      <pre
        data-testid="result-formatted-body"
        class="overflow-auto whitespace-pre-wrap rounded border border-border-muted bg-surface-sunken p-3 font-mono text-xs text-foreground"
      >{{ body() }}</pre>
    </div>
  `,
})
export class FormattedResultComponent {
  readonly body = input<string>('');
  readonly serialization = input<FormatSerialization>('turtle');
}
