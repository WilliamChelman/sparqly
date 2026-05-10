import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-hero-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 200 120"
      aria-hidden="true"
      class="block h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="40" y1="80" x2="100" y2="40" stroke="var(--ink-faint)" stroke-width="0.6" opacity="0.6" />
      <line x1="100" y1="40" x2="160" y2="70" stroke="var(--ink-faint)" stroke-width="0.6" opacity="0.6" />
      <line x1="60" y1="100" x2="100" y2="40" stroke="var(--ink-faint)" stroke-width="0.4" opacity="0.4" />
      <path d="M100 30 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="var(--gold)" />
      <circle cx="40" cy="80" r="3.5" fill="var(--teal)" />
      <circle cx="160" cy="70" r="3.5" fill="var(--teal)" />
      <circle cx="60" cy="100" r="2.5" fill="var(--ink-faint)" opacity="0.55" />
    </svg>
  `,
  styles: [`:host{display:block;width:100%;height:100%}`],
})
export class HeroIllustrationComponent {}
