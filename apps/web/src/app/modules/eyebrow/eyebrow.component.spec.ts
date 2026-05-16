import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EYEBROW_CLASSES, EyebrowComponent } from './eyebrow.component';

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `<span app-eyebrow data-testid="e">label</span>`,
})
class SpanHost {}

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `<h3 app-eyebrow data-testid="e">HEAD</h3>`,
})
class H3Host {}

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `<button app-eyebrow data-testid="e" type="button">tab</button>`,
})
class ButtonHost {}

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `
    <h3 app-eyebrow class="px-2.5 pb-1 pt-2" data-testid="e">HEAD</h3>
  `,
})
class PaddingOverrideHost {}

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `<h2 app-eyebrow class="text-xs" data-testid="e">outbound</h2>`,
})
class TextSizeOverrideHost {}

@Component({
  standalone: true,
  imports: [EyebrowComponent],
  template: `<div app-eyebrow class="font-sans" data-testid="e">#</div>`,
})
class FontOverrideHost {}

function eyebrowEl(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-testid="e"]',
  )!;
}

describe('EYEBROW_CLASSES', () => {
  it('is the golden eyebrow shape', () => {
    expect(EYEBROW_CLASSES).toMatchInlineSnapshot(
      `"font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"`,
    );
  });
});

describe('EyebrowComponent', () => {
  it('applies the eyebrow shape to a <span> host', () => {
    const fixture = TestBed.createComponent(SpanHost);
    fixture.detectChanges();
    const el = eyebrowEl(fixture);
    expect(el.tagName).toBe('SPAN');
    const classes = el.className.split(/\s+/);
    expect(classes).toContain('font-mono');
    expect(classes).toContain('text-[10px]');
    expect(classes).toContain('uppercase');
    expect(classes).toContain('tracking-[0.14em]');
    expect(classes).toContain('text-foreground-faint');
  });

  it('also matches on <h3 app-eyebrow>', () => {
    const fixture = TestBed.createComponent(H3Host);
    fixture.detectChanges();
    const el = eyebrowEl(fixture);
    expect(el.tagName).toBe('H3');
    expect(el.className).toContain('tracking-[0.14em]');
  });

  it('also matches on <button app-eyebrow>', () => {
    const fixture = TestBed.createComponent(ButtonHost);
    fixture.detectChanges();
    const el = eyebrowEl(fixture);
    expect(el.tagName).toBe('BUTTON');
    expect(el.className).toContain('text-[10px]');
  });

  it('preserves orthogonal call-site classes via tailwind-merge composition', () => {
    const fixture = TestBed.createComponent(PaddingOverrideHost);
    fixture.detectChanges();
    const classes = eyebrowEl(fixture).className.split(/\s+/);
    expect(classes).toContain('px-2.5');
    expect(classes).toContain('pb-1');
    expect(classes).toContain('pt-2');
    expect(classes).toContain('font-mono');
    expect(classes).toContain('text-[10px]');
  });

  it('lets a call-site text-xs override the default text-[10px]', () => {
    const fixture = TestBed.createComponent(TextSizeOverrideHost);
    fixture.detectChanges();
    const classes = eyebrowEl(fixture).className.split(/\s+/);
    expect(classes).toContain('text-xs');
    expect(classes).not.toContain('text-[10px]');
  });

  it('lets a call-site font-sans override the default font-mono', () => {
    const fixture = TestBed.createComponent(FontOverrideHost);
    fixture.detectChanges();
    const classes = eyebrowEl(fixture).className.split(/\s+/);
    expect(classes).toContain('font-sans');
    expect(classes).not.toContain('font-mono');
  });
});
