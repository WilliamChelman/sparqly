/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on the host element. The host's tag
// is the consumer's choice (div / section), so the selector enumerates every
// tag the migration actually uses.
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
} from '@angular/core';
import { twMerge } from 'tailwind-merge';

export const CARD_CLASSES =
  'overflow-hidden rounded-lg border border-border bg-surface shadow-sm';

@Component({
  selector: 'div[app-card], section[app-card]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `<ng-content />`,
})
export class CardComponent {
  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() => twMerge(CARD_CLASSES, this.hostClass));
}
