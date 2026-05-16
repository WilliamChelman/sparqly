import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-sun',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  `,
})
export class IconSunComponent {}
