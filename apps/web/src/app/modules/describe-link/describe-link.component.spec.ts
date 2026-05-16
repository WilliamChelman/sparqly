import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DescribeLinkComponent } from './describe-link.component';

@Component({
  standalone: true,
  imports: [DescribeLinkComponent],
  template: `<app-describe-link [iri]="iri" />`,
})
class Host {
  iri = 'http://example.org/alice';
}

function setup(iri: string) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.iri = iri;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DescribeLinkComponent', () => {
  it('links to /describe with the URL-encoded IRI', () => {
    const el = setup('http://example.org/alice');
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a).toBeTruthy();
    expect(a?.getAttribute('href')).toBe(
      '/describe?iri=http%3A%2F%2Fexample.org%2Falice',
    );
  });

  it('opens in a new tab without leaking the opener', () => {
    const el = setup('http://example.org/x');
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('renders the IconTarget component inside an app-btn anchor', () => {
    const el = setup('http://example.org/alice');
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a?.hasAttribute('app-btn')).toBe(true);
    expect(a?.querySelector('app-icon-target')).toBeTruthy();
  });

  it('encodes IRIs containing reserved characters', () => {
    const el = setup('http://example.org/path?x=1&y=2#frag');
    const a = el.querySelector<HTMLAnchorElement>('a[data-testid="describe-this"]');
    expect(a?.getAttribute('href')).toBe(
      `/describe?iri=${encodeURIComponent('http://example.org/path?x=1&y=2#frag')}`,
    );
  });
});
