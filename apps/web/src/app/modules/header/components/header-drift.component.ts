import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  inject,
  signal,
} from '@angular/core';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

@Component({
  selector: 'app-header-drift',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 1200 84"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      class="block h-full w-full"
      aria-hidden="true"
    >
      <g
        data-testid="constellation"
        [attr.data-motion]="motion()"
        [class.drift]="motion() === 'drift'"
        class="header-stars"
      >
        <line x1="120" y1="22" x2="220" y2="50" />
        <line x1="220" y1="50" x2="380" y2="20" />
        <line x1="380" y1="20" x2="520" y2="58" />
        <line x1="700" y1="40" x2="860" y2="22" />
        <line x1="860" y1="22" x2="980" y2="58" />
        <line x1="980" y1="58" x2="1120" y2="34" />
        <path
          class="h-star"
          style="animation-delay:0s"
          fill="var(--gold)"
          opacity="0.85"
          d="M120 22 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z"
        />
        <path
          class="h-star"
          style="animation-delay:.7s"
          fill="var(--teal)"
          opacity="0.7"
          d="M220 50 l1.4 3.5 l3.5 1.4 l-3.5 1.4 l-1.4 3.5 l-1.4 -3.5 l-3.5 -1.4 l3.5 -1.4 z"
        />
        <path
          class="h-star"
          style="animation-delay:1.4s"
          fill="var(--gold)"
          opacity="0.7"
          d="M380 20 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z"
        />
        <path
          class="h-star"
          style="animation-delay:2.1s"
          fill="var(--ink-faint)"
          opacity="0.55"
          d="M520 58 l1 2.5 l2.5 1 l-2.5 1 l-1 2.5 l-1 -2.5 l-2.5 -1 l2.5 -1 z"
        />
        <path
          class="h-star"
          style="animation-delay:0.3s"
          fill="var(--teal)"
          opacity="0.65"
          d="M700 40 l1.3 3.2 l3.2 1.3 l-3.2 1.3 l-1.3 3.2 l-1.3 -3.2 l-3.2 -1.3 l3.2 -1.3 z"
        />
        <path
          class="h-star"
          style="animation-delay:1s"
          fill="var(--gold)"
          opacity="0.75"
          d="M860 22 l1.4 3.5 l3.5 1.4 l-3.5 1.4 l-1.4 3.5 l-1.4 -3.5 l-3.5 -1.4 l3.5 -1.4 z"
        />
        <path
          class="h-star"
          style="animation-delay:1.8s"
          fill="var(--ink-faint)"
          opacity="0.55"
          d="M980 58 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z"
        />
        <path
          class="h-star"
          style="animation-delay:2.4s"
          fill="var(--teal)"
          opacity="0.7"
          d="M1120 34 l1.6 4 l4 1.6 l-4 1.6 l-1.6 4 l-1.6 -4 l-4 -1.6 l4 -1.6 z"
        />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .header-stars line {
        stroke: var(--ink-faint);
        stroke-width: 0.4;
        opacity: 0.35;
      }
      .header-stars .h-star {
        animation: sparqly-twinkle 5s ease-in-out infinite;
        transform-origin: center;
        transform-box: fill-box;
      }
      .header-stars.drift {
        animation: sparqly-drift 38s ease-in-out infinite alternate;
      }
      @keyframes sparqly-twinkle {
        0%,
        100% {
          opacity: 0.85;
          transform: scale(1);
        }
        50% {
          opacity: 0.3;
          transform: scale(0.85);
        }
      }
      @keyframes sparqly-drift {
        from {
          transform: translate3d(0, 0, 0);
        }
        to {
          transform: translate3d(-12px, 4px, 0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .header-stars .h-star,
        .header-stars.drift {
          animation: none;
        }
      }
    `,
  ],
})
export class HeaderDriftComponent {
  private readonly doc = inject(DOCUMENT);
  private readonly reducedMotion = signal<boolean>(false);

  protected readonly motion = computed<'drift' | 'still'>(() =>
    this.reducedMotion() ? 'still' : 'drift',
  );

  constructor() {
    const win = this.doc.defaultView ?? window;
    const mql = win?.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mql) return;

    this.reducedMotion.set(mql.matches);
    const listener = (ev: MediaQueryListEvent) =>
      this.reducedMotion.set(ev.matches);
    mql.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', listener));
  }
}
