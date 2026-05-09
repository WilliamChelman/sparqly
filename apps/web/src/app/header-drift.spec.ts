import { TestBed } from '@angular/core/testing';
import { HeaderDrift } from './header-drift';

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
    addEventListener: (_type, l) => listeners.add(l),
    removeEventListener: (_type, l) => listeners.delete(l),
    fire(matches) {
      this.matches = matches;
      for (const l of listeners) {
        l({ matches } as MediaQueryListEvent);
      }
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql as unknown as MediaQueryList,
  });
  return mql;
}

describe('HeaderDrift', () => {
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('renders an SVG with constellation stars and edges', () => {
    installMatchMediaMock(false);
    const fixture = TestBed.createComponent(HeaderDrift);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg');
    if (!svg) throw new Error('expected svg in HeaderDrift');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  it('marks the constellation as drifting when motion is allowed', () => {
    installMatchMediaMock(false);
    const fixture = TestBed.createComponent(HeaderDrift);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('drift');
  });

  it('suppresses drift when prefers-reduced-motion: reduce', () => {
    installMatchMediaMock(true);
    const fixture = TestBed.createComponent(HeaderDrift);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('still');
  });

  it('reacts to prefers-reduced-motion changes after construction', () => {
    const mql = installMatchMediaMock(false);
    const fixture = TestBed.createComponent(HeaderDrift);
    fixture.detectChanges();
    mql.fire(true);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector(
      'svg [data-testid="constellation"]',
    );
    expect(group?.getAttribute('data-motion')).toBe('still');
  });
});
