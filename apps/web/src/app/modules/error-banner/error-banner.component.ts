/* eslint-disable @angular-eslint/component-selector, @angular-eslint/directive-selector */
// ADR-0034 precedent: attribute component on a native block host, with bare
// attribute names for the iconStart named-slot directive. The lint rule's
// app-/appCamelCase prefix requirements don't fit either choice.
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
import {
  getErrorBannerClasses,
  type ErrorBannerSize,
} from './error-banner.classes';

@Directive({ selector: '[iconStart]', standalone: true })
export class ErrorBannerIconStartDirective {}

@Component({
  selector:
    'p[app-error-banner], div[app-error-banner], ul[app-error-banner], ol[app-error-banner], section[app-error-banner]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
  template: `
    @if (iconStartRef()) {
      <span class="inline-flex h-4 w-4 items-center justify-center" data-slot="iconStart">
        <ng-content select="[iconStart]" />
      </span>
    }
    <ng-content />
  `,
})
export class ErrorBannerComponent {
  readonly size = input<ErrorBannerSize>('sm');

  readonly iconStartRef = contentChild(ErrorBannerIconStartDirective);

  private readonly hostClass: string;

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement;
    this.hostClass = el.getAttribute('class') ?? '';
  }

  readonly classes = computed(() =>
    twMerge(getErrorBannerClasses(this.size()), this.hostClass),
  );
}
