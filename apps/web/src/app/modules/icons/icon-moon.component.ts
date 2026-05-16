import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-moon',
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
      <path d="M13.5 10.2A5.5 5.5 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" />
    </svg>
  `,
})
export class IconMoonComponent {}
