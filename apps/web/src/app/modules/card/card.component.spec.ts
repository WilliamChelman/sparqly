import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CARD_CLASSES, CardComponent } from './card.component';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<div app-card data-testid="c">body</div>`,
})
class DivHost {}

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<section app-card data-testid="c">body</section>`,
})
class SectionHost {}

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<div app-card class="my-frame block" data-testid="c">body</div>`,
})
class OrthogonalOverrideHost {}

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `<div app-card class="rounded-md" data-testid="c">body</div>`,
})
class RoundedOverrideHost {}

function cardEl(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-testid="c"]',
  )!;
}

describe('CARD_CLASSES', () => {
  it('is the golden surface-card shape', () => {
    expect(CARD_CLASSES).toMatchInlineSnapshot(
      `"overflow-hidden rounded-lg border border-border bg-surface shadow-sm"`,
    );
  });
});

describe('CardComponent', () => {
  it('applies the surface-card shape to a <div> host', () => {
    const fixture = TestBed.createComponent(DivHost);
    fixture.detectChanges();
    const el = cardEl(fixture);
    expect(el.tagName).toBe('DIV');
    const classes = el.className.split(/\s+/);
    expect(classes).toContain('overflow-hidden');
    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('border');
    expect(classes).toContain('border-border');
    expect(classes).toContain('bg-surface');
    expect(classes).toContain('shadow-sm');
  });

  it('also matches on <section app-card>', () => {
    const fixture = TestBed.createComponent(SectionHost);
    fixture.detectChanges();
    const el = cardEl(fixture);
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toContain('rounded-lg');
  });

  it('preserves orthogonal call-site classes via tailwind-merge composition', () => {
    const fixture = TestBed.createComponent(OrthogonalOverrideHost);
    fixture.detectChanges();
    const classes = cardEl(fixture).className.split(/\s+/);
    expect(classes).toContain('my-frame');
    expect(classes).toContain('block');
    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('bg-surface');
  });

  it('lets a call-site rounded-md override the default rounded-lg', () => {
    const fixture = TestBed.createComponent(RoundedOverrideHost);
    fixture.detectChanges();
    const classes = cardEl(fixture).className.split(/\s+/);
    expect(classes).toContain('rounded-md');
    expect(classes).not.toContain('rounded-lg');
  });
});
