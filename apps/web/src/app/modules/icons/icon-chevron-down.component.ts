import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-chevron-down',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class="inline-block"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  `,
})
export class IconChevronDownComponent {}
