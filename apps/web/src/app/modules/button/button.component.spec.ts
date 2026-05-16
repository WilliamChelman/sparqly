import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ButtonComponent,
  ButtonIconEndDirective,
  ButtonIconStartDirective,
} from './button.component';

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<button app-btn variant="primary" data-testid="b">Run</button>`,
})
class PrimaryHost {}

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<a app-btn variant="pill" href="#x" data-testid="b">Link</a>`,
})
class AnchorHost {}

@Component({
  standalone: true,
  imports: [ButtonComponent, ButtonIconStartDirective, ButtonIconEndDirective],
  template: `
    <button app-btn variant="primary" [size]="size" data-testid="b">
      <span iconStart data-testid="start-icon">★</span>
      <span>Run</span>
      <span iconEnd data-testid="end-icon">→</span>
    </button>
  `,
})
class SlotsHost {
  size: 'sm' | 'md' = 'md';
}

@Component({
  standalone: true,
  imports: [ButtonComponent, ButtonIconStartDirective],
  template: `
    <button app-btn variant="primary" [loading]="loading" data-testid="b">
      <span iconStart data-testid="start-icon">★</span>
      <span>Run</span>
    </button>
  `,
})
class LoadingHost {
  loading = false;
}

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <button app-btn variant="primary" [loading]="loading" data-testid="b">Run</button>
  `,
})
class LoadingNoIconHost {
  loading = false;
}

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `
    <button app-btn variant="primary" class="rounded-md ml-2" data-testid="b">X</button>
  `,
})
class OverrideHost {}

describe('ButtonComponent', () => {
  it('applies the primary variant classes to a native <button> host', () => {
    const fixture = TestBed.createComponent(PrimaryHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-testid="b"]',
    )!;
    expect(el.className).toContain('bg-accent');
    expect(el.className).toContain('rounded-full');
    expect(el.textContent?.trim()).toBe('Run');
  });

  it('also matches on <a app-btn> and applies variant classes', () => {
    const fixture = TestBed.createComponent(AnchorHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'a[data-testid="b"]',
    )!;
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('#x');
    expect(el.className).toContain('rounded-full');
    expect(el.className).toContain('text-foreground-faint');
  });

  it('projects iconStart/iconEnd slots in size-aware wrappers (md → 16px)', () => {
    const fixture = TestBed.createComponent(SlotsHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const startWrap = root.querySelector('[data-slot="iconStart"]') as HTMLElement;
    const endWrap = root.querySelector('[data-slot="iconEnd"]') as HTMLElement;
    expect(startWrap).not.toBeNull();
    expect(endWrap).not.toBeNull();
    expect(startWrap.className).toContain('h-4');
    expect(startWrap.className).toContain('w-4');
    expect(endWrap.className).toContain('h-4');
    expect(endWrap.className).toContain('w-4');
    expect(startWrap.querySelector('[data-testid="start-icon"]')).not.toBeNull();
    expect(endWrap.querySelector('[data-testid="end-icon"]')).not.toBeNull();
  });

  it('omits both slot wrappers when no icon is projected', () => {
    const fixture = TestBed.createComponent(PrimaryHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-slot="iconStart"]')).toBeNull();
    expect(root.querySelector('[data-slot="iconEnd"]')).toBeNull();
  });

  it('uses 14px wrappers when size is sm', () => {
    const fixture = TestBed.createComponent(SlotsHost);
    fixture.componentInstance.size = 'sm';
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const startWrap = root.querySelector('[data-slot="iconStart"]') as HTMLElement;
    expect(startWrap.className).toContain('h-3.5');
    expect(startWrap.className).toContain('w-3.5');
  });

  it('replaces the iconStart slot with a spinner when [loading]', () => {
    const fixture = TestBed.createComponent(LoadingHost);
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const startWrap = root.querySelector('[data-slot="iconStart"]') as HTMLElement;
    expect(startWrap.querySelector('app-icon-spinner')).not.toBeNull();
    expect(startWrap.querySelector('[data-testid="start-icon"]')).toBeNull();
  });

  it('prepends a spinner in the iconStart wrapper when [loading] and no iconStart was projected', () => {
    const fixture = TestBed.createComponent(LoadingNoIconHost);
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const startWrap = root.querySelector('[data-slot="iconStart"]') as HTMLElement;
    expect(startWrap).not.toBeNull();
    expect(startWrap.querySelector('app-icon-spinner')).not.toBeNull();
  });

  it('sets aria-busy="true" and disables the host while [loading]', () => {
    const fixture = TestBed.createComponent(LoadingHost);
    fixture.componentInstance.loading = true;
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-testid="b"]',
    )!;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
  });

  it('does not set aria-busy or disabled when [loading] is false', () => {
    const fixture = TestBed.createComponent(LoadingHost);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-testid="b"]',
    )!;
    expect(btn.getAttribute('aria-busy')).toBeNull();
    expect(btn.disabled).toBe(false);
  });

  it('lets call-site class overrides win via tailwind-merge composition', () => {
    const fixture = TestBed.createComponent(OverrideHost);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-testid="b"]',
    )!;
    const classes = btn.className.split(/\s+/);
    expect(classes).toContain('rounded-md');
    expect(classes).not.toContain('rounded-full');
    expect(classes).toContain('ml-2');
    expect(classes).toContain('bg-accent');
  });

  it('preserves classes added externally (eg routerLinkActive) across host re-renders', () => {
    const fixture = TestBed.createComponent(PrimaryHost);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-testid="b"]',
    )!;
    btn.classList.add('externally-added');
    expect(btn.classList.contains('externally-added')).toBe(true);
    // Force a re-render by detecting changes (any signal write would do; the
    // host [class] binding re-evaluates its computed).
    fixture.detectChanges();
    expect(btn.classList.contains('externally-added')).toBe(true);
    expect(btn.classList.contains('bg-accent')).toBe(true);
  });
});
