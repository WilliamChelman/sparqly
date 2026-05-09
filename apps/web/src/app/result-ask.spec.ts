import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AskResult } from '@app/core';
import { ResultAsk } from './result-ask';

@Component({
  standalone: true,
  imports: [ResultAsk],
  template: `<app-result-ask [result]="result" />`,
})
class Host {
  result: AskResult = {
    kind: 'ask',
    value: false,
    raw: '',
    contentType: 'application/sparql-results+json',
  };
}

describe('ResultAsk', () => {
  it('renders a centered glyph card showing TRUE for an ASK=true result', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'ask',
      value: true,
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-ask"]',
    );
    expect(card).toBeTruthy();
    expect(card?.getAttribute('data-value')).toBe('true');
    expect(card?.textContent).toContain('TRUE');
  });

  it('renders FALSE for an ASK=false result', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result = {
      kind: 'ask',
      value: false,
      raw: '',
      contentType: 'application/sparql-results+json',
    };
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="result-ask"]',
    );
    expect(card?.getAttribute('data-value')).toBe('false');
    expect(card?.textContent).toContain('FALSE');
  });
});
