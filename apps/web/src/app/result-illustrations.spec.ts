import { TestBed } from '@angular/core/testing';
import {
  ErrorConstellation,
  HeroIllustration,
  LoadingConstellation,
} from './result-illustrations';

type MqlListener = (ev: MediaQueryListEvent) => void;

interface MockMql {
  matches: boolean;
  media: string;
  addEventListener(type: 'change', listener: MqlListener): void;
  removeEventListener(type: 'change', listener: MqlListener): void;
  fire(matches: boolean): void;
}

function installMatchMediaMock(initial: boolean): MockMql {
  const listeners = new Set<MqlListener>();
  const mql: MockMql = {
    matches: initial,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_t, l) => listeners.add(l),
    removeEventListener: (_t, l) => listeners.delete(l),
    fire(matches) {
      this.matches = matches;
      for (const l of listeners) l({ matches } as MediaQueryListEvent);
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql as unknown as MediaQueryList,
  });
  return mql;
}

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('HeroIllustration', () => {
  it('renders an SVG', () => {
    installMatchMediaMock(false);
    const fixture = TestBed.createComponent(HeroIllustration);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).toBeTruthy();
  });
});

describe('LoadingConstellation', () => {
  it('marks itself spinning when motion is allowed', () => {
    installMatchMediaMock(false);
    const fixture = TestBed.createComponent(LoadingConstellation);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="loading-constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('spin');
  });

  it('suppresses motion under prefers-reduced-motion: reduce', () => {
    installMatchMediaMock(true);
    const fixture = TestBed.createComponent(LoadingConstellation);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="loading-constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('still');
  });

  it('reacts to motion-preference changes after construction', () => {
    const mql = installMatchMediaMock(false);
    const fixture = TestBed.createComponent(LoadingConstellation);
    fixture.detectChanges();
    mql.fire(true);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="loading-constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('still');
  });
});

describe('ErrorConstellation', () => {
  it('renders an SVG', () => {
    installMatchMediaMock(false);
    const fixture = TestBed.createComponent(ErrorConstellation);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
