import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { AskResult } from './sparql-result-decoder';
import { StateCard } from './state-card';

@Component({
  selector: 'app-result-ask',
  standalone: true,
  imports: [StateCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="result-ask" [attr.data-value]="value()">
      <app-state-card>
        <div illustration class="flex h-full items-center justify-center">
          @if (value() === 'true') {
            <span class="font-serif text-6xl text-accent">✓</span>
          } @else {
            <span class="font-serif text-6xl text-foreground-faint">✗</span>
          }
        </div>
        <div title>{{ label() }}</div>
        <div copy>SPARQL ASK</div>
      </app-state-card>
    </div>
  `,
})
export class ResultAsk {
  readonly result = input.required<AskResult>();
  readonly value = computed<'true' | 'false'>(() =>
    this.result().value ? 'true' : 'false',
  );
  readonly label = computed(() =>
    this.result().value ? 'TRUE' : 'FALSE',
  );
}
