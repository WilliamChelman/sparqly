import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CodeBlockComponent, type CodeLine } from '@app/modules/code-highlight';

@Component({
  selector: 'app-result-raw',
  standalone: true,
  imports: [CodeBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="result-raw" [attr.data-content-type]="contentType()">
      <app-code-block [text]="text()" [lines]="lines()" />
    </div>
  `,
})
export class ResultRawComponent {
  readonly text = input<string>('');
  readonly contentType = input<string>('');
  /** The highlight token model, or `null` to render the body as plain text. */
  readonly lines = input<CodeLine[] | null>(null);
}
