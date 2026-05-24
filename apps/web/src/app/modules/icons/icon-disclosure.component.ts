import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-icon-disclosure',
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
      class="inline-block transition-transform duration-150"
      [class.rotate-90]="expanded()"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  `,
})
export class IconDisclosureComponent {
  readonly expanded = input<boolean>(false);
}
