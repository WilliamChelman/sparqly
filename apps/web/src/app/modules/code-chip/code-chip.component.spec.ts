import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CODE_CHIP_CLASSES, CodeChipComponent } from './code-chip.component';

@Component({
  standalone: true,
  imports: [CodeChipComponent],
  template: `<code app-code-chip data-testid="c">/diff</code>`,
})
class CodeHost {}

@Component({
  standalone: true,
  imports: [CodeChipComponent],
  template: `
    <code app-code-chip class="text-[11px]" data-testid="c">sparqly serve</code>
  `,
})
class TextSizeOverrideHost {}

@Component({
  standalone: true,
  imports: [CodeChipComponent],
  template: `<code app-code-chip class="px-2" data-testid="c">x</code>`,
})
class PaddingOverrideHost {}

@Component({
  standalone: true,
  imports: [CodeChipComponent],
  template: `<code app-code-chip class="font-sans" data-testid="c">x</code>`,
})
class FontOverrideHost {}

function chipEl(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-testid="c"]',
  )!;
}

describe('CODE_CHIP_CLASSES', () => {
  it('is the golden code-chip shape', () => {
    expect(CODE_CHIP_CLASSES).toMatchInlineSnapshot(
      `"rounded bg-surface-sunken px-1 py-0.5 font-mono"`,
    );
  });
});

describe('CodeChipComponent', () => {
  it('applies the code-chip shape to a <code> host', () => {
    const fixture = TestBed.createComponent(CodeHost);
    fixture.detectChanges();
    const el = chipEl(fixture);
    expect(el.tagName).toBe('CODE');
    const classes = el.className.split(/\s+/);
    expect(classes).toContain('rounded');
    expect(classes).toContain('bg-surface-sunken');
    expect(classes).toContain('px-1');
    expect(classes).toContain('py-0.5');
    expect(classes).toContain('font-mono');
  });

  it('lets a call-site text-[11px] add on top of the default shape', () => {
    const fixture = TestBed.createComponent(TextSizeOverrideHost);
    fixture.detectChanges();
    const classes = chipEl(fixture).className.split(/\s+/);
    expect(classes).toContain('text-[11px]');
    expect(classes).toContain('font-mono');
    expect(classes).toContain('rounded');
  });

  it('lets a call-site px-2 override the default px-1 via tailwind-merge', () => {
    const fixture = TestBed.createComponent(PaddingOverrideHost);
    fixture.detectChanges();
    const classes = chipEl(fixture).className.split(/\s+/);
    expect(classes).toContain('px-2');
    expect(classes).not.toContain('px-1');
    expect(classes).toContain('py-0.5');
  });

  it('lets a call-site font-sans override the default font-mono', () => {
    const fixture = TestBed.createComponent(FontOverrideHost);
    fixture.detectChanges();
    const classes = chipEl(fixture).className.split(/\s+/);
    expect(classes).toContain('font-sans');
    expect(classes).not.toContain('font-mono');
  });
});
