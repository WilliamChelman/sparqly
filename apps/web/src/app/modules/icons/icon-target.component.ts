import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-target',
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
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle cx="8" cy="8" r="1.5" />
      <path
        d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class IconTargetComponent {}
