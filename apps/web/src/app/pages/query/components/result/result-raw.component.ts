import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-result-raw',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="result-raw" [attr.data-content-type]="contentType()">
      <pre
        data-testid="result-raw-body"
        class="overflow-auto whitespace-pre-wrap rounded border border-border-muted bg-surface-sunken p-3 font-mono text-xs text-foreground"
      >{{ text() }}</pre>
    </div>
  `,
})
export class ResultRawComponent {
  readonly text = input<string>('');
  readonly contentType = input<string>('');
}
