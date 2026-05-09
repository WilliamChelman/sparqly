import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-logomark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 128 128" aria-hidden="true" class="block h-full w-full">
      <line
        x1="64"
        y1="64"
        x2="22"
        y2="34"
        stroke="var(--ink-faint)"
        stroke-width="0.6"
        opacity="0.55"
      />
      <line
        x1="64"
        y1="64"
        x2="104"
        y2="42"
        stroke="var(--ink-faint)"
        stroke-width="0.6"
        opacity="0.55"
      />
      <line
        x1="64"
        y1="64"
        x2="34"
        y2="100"
        stroke="var(--ink-faint)"
        stroke-width="0.6"
        opacity="0.55"
      />
      <path
        d="M64 28 L70 60 L96 64 L70 68 L64 100 L58 68 L32 64 L58 60 Z"
        fill="var(--gold)"
      />
      <circle cx="22" cy="34" r="4" fill="var(--teal)" />
      <circle cx="104" cy="42" r="3.5" fill="var(--teal)" />
      <circle cx="34" cy="100" r="3.5" fill="var(--teal)" />
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
    `,
  ],
})
export class Logomark {}
