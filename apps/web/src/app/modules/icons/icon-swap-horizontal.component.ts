import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-swap-horizontal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5h10" />
      <path d="M9.5 2 12.5 5 9.5 8" />
      <path d="M13.5 11h-10" />
      <path d="M6.5 14 3.5 11 6.5 8" />
    </svg>
  `,
})
export class IconSwapHorizontalComponent {}
