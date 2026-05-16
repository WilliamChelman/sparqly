import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ErrorBannerComponent,
  ErrorBannerIconStartDirective,
} from './error-banner.component';

@Component({
  standalone: true,
  imports: [ErrorBannerComponent],
  template: `<p app-error-banner data-testid="b">boom</p>`,
})
class DefaultSizeHost {}

@Component({
  standalone: true,
  imports: [ErrorBannerComponent],
  template: `<p app-error-banner size="md" data-testid="b">boom</p>`,
})
class MdHost {}

@Component({
  standalone: true,
  imports: [ErrorBannerComponent],
  template: `<ul app-error-banner data-testid="b"><li>x</li></ul>`,
})
class UlHost {}

@Component({
  standalone: true,
  imports: [ErrorBannerComponent, ErrorBannerIconStartDirective],
  template: `
    <p app-error-banner size="md" data-testid="b">
      <span iconStart data-testid="start-icon">!</span>
      <span>boom</span>
    </p>
  `,
})
class IconSlotHost {}

@Component({
  standalone: true,
  imports: [ErrorBannerComponent],
  template: `
    <p app-error-banner class="flex flex-col gap-1" data-testid="b">boom</p>
  `,
})
class OverrideHost {}

describe('ErrorBannerComponent', () => {
  it('defaults to size=sm and applies the small variant classes to a <p> host', () => {
    const fixture = TestBed.createComponent(DefaultSizeHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLParagraphElement>(
      'p[data-testid="b"]',
    )!;
    expect(el.tagName).toBe('P');
    expect(el.className).toContain('rounded');
    expect(el.className).toContain('border-error-line');
    expect(el.className).toContain('p-2');
    expect(el.className).toContain('text-sm');
    expect(el.className).not.toContain('text-xs');
    expect(el.textContent?.trim()).toBe('boom');
  });

  it('applies the md variant classes when size="md"', () => {
    const fixture = TestBed.createComponent(MdHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'p[data-testid="b"]',
    )!;
    expect(el.className).toContain('rounded-lg');
    expect(el.className).toContain('px-3.5');
    expect(el.className).toContain('py-3');
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('text-xs');
  });

  it('also matches on <ul app-error-banner>', () => {
    const fixture = TestBed.createComponent(UlHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'ul[data-testid="b"]',
    )!;
    expect(el.tagName).toBe('UL');
    expect(el.className).toContain('border-error-line');
  });

  it('projects the iconStart slot inside a wrapper when given', () => {
    const fixture = TestBed.createComponent(IconSlotHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const wrap = root.querySelector('[data-slot="iconStart"]') as HTMLElement;
    expect(wrap).not.toBeNull();
    expect(wrap.querySelector('[data-testid="start-icon"]')).not.toBeNull();
  });

  it('omits the iconStart wrapper when no icon is projected', () => {
    const fixture = TestBed.createComponent(DefaultSizeHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-slot="iconStart"]')).toBeNull();
  });

  it('lets call-site class overrides win via tailwind-merge composition', () => {
    const fixture = TestBed.createComponent(OverrideHost);
    fixture.detectChanges();
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'p[data-testid="b"]',
    )!;
    const classes = el.className.split(/\s+/);
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-col');
    expect(classes).toContain('gap-1');
    expect(classes).toContain('border-error-line');
    expect(classes).toContain('bg-error-bg');
  });
});
