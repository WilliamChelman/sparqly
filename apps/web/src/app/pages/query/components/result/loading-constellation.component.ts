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

function useReducedMotion(): () => boolean {
  const doc = inject(DOCUMENT);
  const reduced = signal<boolean>(false);
  const win = doc.defaultView ?? window;
  const mql = win?.matchMedia?.(REDUCED_MOTION_QUERY);
  if (mql) {
    reduced.set(mql.matches);
    const listener = (ev: MediaQueryListEvent) => reduced.set(ev.matches);
    mql.addEventListener('change', listener);
    inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', listener));
  }
  return reduced;
}

@Component({
  selector: 'app-loading-constellation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 200 120"
      aria-hidden="true"
      class="block h-full w-full"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        data-testid="loading-constellation"
        [attr.data-motion]="motion()"
        [class.spin]="motion() === 'spin'"
        class="loading-stars"
      >
        <circle cx="100" cy="60" r="32" fill="none" stroke="var(--ink-faint)" stroke-width="0.4" opacity="0.35" />
        <path class="l-star" style="animation-delay:0s" fill="var(--gold)" d="M100 28 l1.4 3.5 l3.5 1.4 l-3.5 1.4 l-1.4 3.5 l-1.4 -3.5 l-3.5 -1.4 l3.5 -1.4 z" />
        <path class="l-star" style="animation-delay:.5s" fill="var(--teal)" d="M132 60 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" />
        <path class="l-star" style="animation-delay:1s" fill="var(--gold)" d="M100 92 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" />
        <path class="l-star" style="animation-delay:1.5s" fill="var(--teal)" d="M68 60 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" />
      </g>
    </svg>
  `,
  styles: [
    `
      :host { display:block; width:100%; height:100%; }
      .loading-stars .l-star {
        animation: sparqly-pulse 1.6s ease-in-out infinite;
        transform-origin: center;
        transform-box: fill-box;
      }
      .loading-stars.spin {
        animation: sparqly-spin 6s linear infinite;
        transform-origin: 100px 60px;
      }
      @keyframes sparqly-pulse {
        0%,100% { opacity: 0.95; transform: scale(1); }
        50%     { opacity: 0.35; transform: scale(0.85); }
      }
      @keyframes sparqly-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .loading-stars .l-star, .loading-stars.spin { animation: none; }
      }
    `,
  ],
})
export class LoadingConstellationComponent {
  private readonly reducedMotion = useReducedMotion();
  protected readonly motion = computed<'spin' | 'still'>(() =>
    this.reducedMotion() ? 'still' : 'spin',
  );
}
