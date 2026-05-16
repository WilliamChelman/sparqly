/* eslint-disable @angular-eslint/component-selector, @angular-eslint/directive-selector */
// ADR-0034: this primitive is an attribute component on native <button>/<a>
// hosts, and its iconStart/iconEnd named-slot directives use bare attribute
// names by design — the lint rule's app-/appCamelCase prefix requirements
// don't fit either choice.
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { twMerge } from 'tailwind-merge';
import { IconSpinnerComponent } from '@app/modules/icons';
import { getButtonClasses, type ButtonSize, type ButtonVariant } from './button.classes';

@Directive({ selector: '[iconStart]', standalone: true })
export class ButtonIconStartDirective {}

@Directive({ selector: '[iconEnd]', standalone: true })
export class ButtonIconEndDirective {}

@Component({
  selector: 'button[app-btn], a[app-btn]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconSpinnerComponent],
  host: {
    '[class]': 'classes()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[attr.disabled]': 'loading() ? "" : null',
  },
  template: `
    @if (loading()) {
      <span [class]="iconWrapClasses()" data-slot="iconStart">
        <app-icon-spinner />
      </span>
    } @else if (iconStartRef()) {
      <span [class]="iconWrapClasses()" data-slot="iconStart">
        <ng-content select="[iconStart]" />
      </span>
    }
    <ng-content />
    @if (iconEndRef()) {
      <span [class]="iconWrapClasses()" data-slot="iconEnd">
        <ng-content select="[iconEnd]" />
      </span>
    }
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly loading = input<boolean>(false);

  readonly iconStartRef = contentChild(ButtonIconStartDirective);
  readonly iconEndRef = contentChild(ButtonIconEndDirective);

  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() =>
    twMerge(getButtonClasses(this.variant(), this.size(), this.loading()), this.hostClass),
  );
  readonly iconWrapClasses = computed(() =>
    this.size() === 'sm'
      ? 'inline-flex h-3.5 w-3.5 items-center justify-center'
      : 'inline-flex h-4 w-4 items-center justify-center',
  );
}
