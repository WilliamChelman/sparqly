/* eslint-disable @angular-eslint/component-selector */
// ADR-0034 precedent: attribute component on native form controls. The host
// keeps its tag (`<input>` / `<select>` / `<textarea>`) so `type`, `value`,
// `placeholder`, `disabled`, form bindings, and Angular events forward
// transparently without re-exposure.
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
} from '@angular/core';
import { twMerge } from 'tailwind-merge';

const BASE =
  'rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground shadow-sm transition-[border-color,box-shadow] placeholder:text-foreground-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50';

const SELECT_SHAPE =
  'cursor-pointer appearance-none bg-[length:10px_10px] bg-no-repeat pr-7 bg-[right_0.5rem_center]';

const SELECT_BG_LIGHT =
  "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M2 4 L5 7 L8 4' stroke='%235a5870' stroke-width='1.4' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")]";

export const INPUT_CLASSES = BASE;
export const SELECT_CLASSES = `${BASE} ${SELECT_SHAPE} ${SELECT_BG_LIGHT}`;

@Component({
  selector: 'input[app-input], textarea[app-input]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `<ng-content />`,
})
export class InputComponent {
  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() => twMerge(INPUT_CLASSES, this.hostClass));
}

@Component({
  selector: 'select[app-input]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `<ng-content />`,
})
export class SelectComponent {
  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() => twMerge(SELECT_CLASSES, this.hostClass));
}
