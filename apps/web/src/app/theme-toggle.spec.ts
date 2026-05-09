import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService, type ThemeMode } from './theme.service';
import { ThemeToggle } from './theme-toggle';

class FakeThemeService {
  private readonly modeSignal = signal<ThemeMode>('system');
  readonly mode = this.modeSignal.asReadonly();
  set(mode: ThemeMode) {
    this.modeSignal.set(mode);
  }
}

function setup() {
  const fake = new FakeThemeService();
  TestBed.configureTestingModule({
    providers: [{ provide: ThemeService, useValue: fake }],
  });
  const fixture = TestBed.createComponent(ThemeToggle);
  fixture.detectChanges();
  return { fixture, fake };
}

function buttonByMode(el: HTMLElement, mode: ThemeMode): HTMLButtonElement {
  const btn = el.querySelector<HTMLButtonElement>(
    `button[data-mode="${mode}"]`,
  );
  if (!btn) throw new Error(`no button for mode ${mode}`);
  return btn;
}

describe('ThemeToggle', () => {
  it('renders a button per mode (light/dark/system)', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(buttonByMode(el, 'light')).toBeTruthy();
    expect(buttonByMode(el, 'dark')).toBeTruthy();
    expect(buttonByMode(el, 'system')).toBeTruthy();
  });

  it('calls service.set when a mode button is clicked', () => {
    const { fixture, fake } = setup();
    const el = fixture.nativeElement as HTMLElement;
    buttonByMode(el, 'light').click();
    expect(fake.mode()).toBe('light');
    buttonByMode(el, 'dark').click();
    expect(fake.mode()).toBe('dark');
  });

  it('marks the current mode with aria-pressed=true', () => {
    const { fixture, fake } = setup();
    fake.set('dark');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(buttonByMode(el, 'dark').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByMode(el, 'light').getAttribute('aria-pressed')).toBe('false');
    expect(buttonByMode(el, 'system').getAttribute('aria-pressed')).toBe('false');
  });
});
