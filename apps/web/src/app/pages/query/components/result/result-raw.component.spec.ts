import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ResultRawComponent } from './result-raw.component';

@Component({
  standalone: true,
  imports: [ResultRawComponent],
  template: `<app-result-raw [text]="text" [contentType]="contentType" />`,
})
class Host {
  text = '';
  contentType = 'text/plain';
}

describe('ResultRawComponent', () => {
  it('renders the unparsed body inside a <pre> with a JetBrains Mono font class', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.text = '<a> <b> <c> .';
    fixture.componentInstance.contentType = 'text/turtle';
    fixture.detectChanges();
    const pre = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-raw-body"]',
    ) as HTMLElement | null;
    expect(pre).toBeTruthy();
    expect(pre?.tagName).toBe('PRE');
    expect(pre?.textContent).toContain('<a> <b> <c> .');
    expect(pre?.className).toContain('font-mono');
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
