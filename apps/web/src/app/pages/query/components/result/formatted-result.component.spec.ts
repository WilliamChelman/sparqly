import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { tokenizeCode, type CodeLine } from '@app/modules/code-highlight';
import type { FormatSerialization } from 'common';
import { FormattedResultComponent } from './formatted-result.component';

@Component({
  standalone: true,
  imports: [FormattedResultComponent],
  template: `<app-formatted-result
    [body]="body"
    [serialization]="serialization"
    [lines]="lines"
  />`,
})
class Host {
  body = '';
  serialization: FormatSerialization = 'turtle';
  lines: CodeLine[] | null = null;
}

function codeBlock(
  fixture: ReturnType<typeof TestBed.createComponent>,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="code-block"]',
  );
}

describe('FormattedResultComponent', () => {
  it('renders the formatted body byte-identically with cm-* token spans when a highlight model is given', () => {
    const fixture = TestBed.createComponent(Host);
    const body = '<http://example.org/a> <http://example.org/p> "x" .\n';
    fixture.componentInstance.body = body;
    fixture.componentInstance.serialization = 'turtle';
    fixture.componentInstance.lines = tokenizeCode(body, 'turtle');
    fixture.detectChanges();
    const pre = codeBlock(fixture);
    expect(pre?.tagName).toBe('PRE');
    expect(pre?.textContent).toBe(body);
    // Highlighting added colour: the body now carries cm-* token spans.
    expect(pre?.querySelector('span[class^="cm-"]')).toBeTruthy();
  });

  it('renders the body as plain text without token spans when no highlight model is supplied', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.body = '<http://example.org/a> a <urn:thing> .';
    fixture.componentInstance.lines = null;
    fixture.detectChanges();
    const pre = codeBlock(fixture);
    expect(pre?.textContent).toBe('<http://example.org/a> a <urn:thing> .');
    expect(pre?.querySelector('span')).toBeNull();
  });

  it('exposes the serialization via a data attribute', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.serialization = 'trig';
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-formatted"]',
    );
    expect(root?.getAttribute('data-serialization')).toBe('trig');
  });
});
