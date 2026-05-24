/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on the host element. The host's tag
// is the consumer's choice; the attribute selector matches any element.
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
} from '@angular/core';
import { twMerge } from 'tailwind-merge';

export const EYEBROW_CLASSES =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint';

@Component({
  selector: '[app-eyebrow]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `<ng-content />`,
})
export class EyebrowComponent {
  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() => twMerge(EYEBROW_CLASSES, this.hostClass));
}
