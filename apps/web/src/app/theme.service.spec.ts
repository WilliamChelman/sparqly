import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/core';
import { ThemeService } from './theme.service';

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
    media: '(prefers-color-scheme: dark)',
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

describe('ThemeService', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('test');
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: doc }],
    });
  });

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('applies data-theme on the document element when set is called', () => {
    const controller = TestBed.inject(ThemeService);

    controller.set('light');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');

    controller.set('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('exposes the current mode through a signal', () => {
    const controller = TestBed.inject(ThemeService);
    controller.set('dark');
    expect(controller.mode()).toBe('dark');
    controller.set('system');
    expect(controller.mode()).toBe('system');
  });

  it('persists light/dark to localStorage and removes the key on system', () => {
    const controller = TestBed.inject(ThemeService);
    controller.set('dark');
    expect(localStorage.getItem('sparqly:theme')).toBe('dark');
    controller.set('light');
    expect(localStorage.getItem('sparqly:theme')).toBe('light');
    controller.set('system');
    expect(localStorage.getItem('sparqly:theme')).toBeNull();
  });

  it('reads the initial mode from localStorage on construction', () => {
    localStorage.setItem('sparqly:theme', 'dark');
    const controller = TestBed.inject(ThemeService);
    expect(controller.mode()).toBe('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it("defaults to 'system' when no localStorage entry exists", () => {
    const controller = TestBed.inject(ThemeService);
    expect(controller.mode()).toBe('system');
  });

  it("falls back to 'system' when localStorage holds an unexpected value", () => {
    localStorage.setItem('sparqly:theme', 'plaid');
    const controller = TestBed.inject(ThemeService);
    expect(controller.mode()).toBe('system');
  });

  it("resolved follows prefers-color-scheme when mode is 'system'", () => {
    const mql = installMatchMediaMock(true);
    const controller = TestBed.inject(ThemeService);
    expect(controller.resolved()).toBe('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    mql.fire(false);
    expect(controller.resolved()).toBe('light');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it("resolved equals the explicit mode when mode is 'light' or 'dark'", () => {
    installMatchMediaMock(true); // system would say 'dark'
    const controller = TestBed.inject(ThemeService);
    controller.set('light');
    expect(controller.resolved()).toBe('light');
    controller.set('dark');
    expect(controller.resolved()).toBe('dark');
  });

  it('syncs mode when localStorage changes in another tab', () => {
    const controller = TestBed.inject(ThemeService);
    expect(controller.mode()).toBe('system');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'sparqly:theme',
        newValue: 'dark',
        oldValue: null,
      }),
    );
    expect(controller.mode()).toBe('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'sparqly:theme',
        newValue: null,
        oldValue: 'dark',
      }),
    );
    expect(controller.mode()).toBe('system');
  });

  it('ignores storage events for unrelated keys', () => {
    const controller = TestBed.inject(ThemeService);
    controller.set('light');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'unrelated',
        newValue: 'dark',
      }),
    );
    expect(controller.mode()).toBe('light');
  });
});
