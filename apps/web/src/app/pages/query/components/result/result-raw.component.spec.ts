import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { tokenizeCode, type CodeLine } from '@app/modules/code-highlight';
import { ResultRawComponent } from './result-raw.component';

@Component({
  standalone: true,
  imports: [ResultRawComponent],
  template: `<app-result-raw
    [text]="text"
    [contentType]="contentType"
    [lines]="lines"
  />`,
})
class Host {
  text = '';
  contentType = 'text/plain';
  lines: CodeLine[] | null = null;
}

function codeBlock(
  fixture: ReturnType<typeof TestBed.createComponent>,
): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    '[data-testid="code-block"]',
  );
}

describe('ResultRawComponent', () => {
  it('renders the unparsed body byte-identically when a highlight model is given', () => {
    const fixture = TestBed.createComponent(Host);
    const raw = '<http://example.org/a> <http://example.org/p> "x" .';
    fixture.componentInstance.text = raw;
    fixture.componentInstance.contentType = 'text/turtle';
    fixture.componentInstance.lines = tokenizeCode(raw, 'turtle');
    fixture.detectChanges();
    const pre = codeBlock(fixture);
    expect(pre?.tagName).toBe('PRE');
    expect(pre?.textContent).toBe(raw);
    // Highlighting added colour: the body now carries cm-* token spans.
    expect(pre?.querySelector('span[class^="cm-"]')).toBeTruthy();
  });

  it('renders plain text when no highlight model is supplied', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = '<rdf/>unhighlighted';
    fixture.componentInstance.contentType = 'application/rdf+xml';
    fixture.componentInstance.lines = null;
    fixture.detectChanges();
    const pre = codeBlock(fixture);
    expect(pre?.textContent).toBe('<rdf/>unhighlighted');
    expect(pre?.querySelector('span')).toBeNull();
  });

  it('exposes the content-type via a data attribute', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = '{}';
    fixture.componentInstance.contentType = 'application/sparql-results+json';
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-raw"]',
    );
    expect(root?.getAttribute('data-content-type')).toBe(
      'application/sparql-results+json',
    );
  });
});
