import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CodeBlockComponent } from './code-block.component';
import { tokenizeCode, type CodeLine } from './code-highlight';

@Component({
  standalone: true,
  imports: [CodeBlockComponent],
  template: `<app-code-block [text]="text" [lines]="lines" />`,
})
class Host {
  text = '';
  lines: CodeLine[] | null = null;
}

function block(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    '[data-testid="code-block"]',
  )!;
}

describe('CodeBlockComponent', () => {
  it('renders each token as a styled span inside a cm-s-sparqly <pre>', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = 'ex:s "lit"';
    fixture.componentInstance.lines = [
      [
        { text: 'ex:s', className: 'cm-variable-3' },
        { text: ' ', className: '' },
        { text: '"lit"', className: 'cm-string' },
      ],
    ];
    fixture.detectChanges();
    const pre = block(fixture);
    expect(pre.tagName).toBe('PRE');
    expect(pre.classList).toContain('cm-s-sparqly');
    expect(pre.querySelector('.cm-variable-3')?.textContent).toBe('ex:s');
    expect(pre.querySelector('.cm-string')?.textContent).toBe('"lit"');
  });

  it('renders raw text as a plain fallback when lines is null', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = '<unhighlightable> body';
    fixture.componentInstance.lines = null;
    fixture.detectChanges();
    const pre = block(fixture);
    expect(pre.textContent).toBe('<unhighlightable> body');
    expect(pre.classList).toContain('cm-s-sparqly');
    expect(pre.querySelector('span')).toBeNull();
  });

  it('keeps displayed text byte-identical to the input across lines', () => {
    const input = '@prefix ex: <http://example.org/> .\nex:s ex:p "lit" .\n';
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = input;
    fixture.componentInstance.lines = tokenizeCode(input, 'turtle');
    fixture.detectChanges();
    expect(block(fixture).textContent).toBe(input);
  });
});
