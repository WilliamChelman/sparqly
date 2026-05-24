import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CodeBlockComponent, type CodeLine } from '@app/modules/code-highlight';
import type { FormatSerialization } from 'common';

@Component({
  selector: 'app-formatted-result',
  standalone: true,
  imports: [CodeBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-code-block [text]="body()" [lines]="lines()" />
  `,
})
export class FormattedResultComponent {
  readonly body = input<string>('');
  readonly serialization = input<FormatSerialization>('turtle');
  /** The turtle/trig highlight token model, or `null` to render plain text. */
  readonly lines = input<CodeLine[] | null>(null);
}
