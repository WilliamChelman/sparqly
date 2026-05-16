import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-system',
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
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13V1.5z" />
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
      />
    </svg>
  `,
})
export class IconSystemComponent {}
