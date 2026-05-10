import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-error-constellation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 200 120"
      aria-hidden="true"
      class="block h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="60" y1="40" x2="140" y2="80" stroke="var(--error)" stroke-width="0.8" opacity="0.55" />
      <line x1="140" y1="40" x2="60" y2="80" stroke="var(--error)" stroke-width="0.8" opacity="0.55" />
      <circle cx="60" cy="40" r="3.5" fill="var(--error)" opacity="0.85" />
      <circle cx="140" cy="40" r="3.5" fill="var(--error)" opacity="0.85" />
      <circle cx="60" cy="80" r="3.5" fill="var(--error)" opacity="0.85" />
      <circle cx="140" cy="80" r="3.5" fill="var(--error)" opacity="0.85" />
      <path d="M100 60 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z" fill="var(--ink-faint)" opacity="0.7" />
    </svg>
  `,
  styles: [`:host{display:block;width:100%;height:100%}`],
})
export class ErrorConstellationComponent {}
