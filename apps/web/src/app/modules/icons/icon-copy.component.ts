import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-copy',
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
      <rect
        x="3"
        y="5"
        width="8"
        height="9"
        rx="1.25"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path
        d="M5.5 5V3.25A1.25 1.25 0 0 1 6.75 2h6A1.25 1.25 0 0 1 14 3.25v6A1.25 1.25 0 0 1 12.75 10.5H11"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
    </svg>
  `,
})
export class IconCopyComponent {}
