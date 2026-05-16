/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on the host element. The host stays
// a semantic <code> for assistive tech.
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
} from '@angular/core';
import { twMerge } from 'tailwind-merge';

export const CODE_CHIP_CLASSES =
  'rounded bg-surface-sunken px-1 py-0.5 font-mono';

@Component({
  selector: 'code[app-code-chip]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `<ng-content />`,
})
export class CodeChipComponent {
  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() => twMerge(CODE_CHIP_CLASSES, this.hostClass));
}
