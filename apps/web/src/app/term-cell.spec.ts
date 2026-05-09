import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DisplayContext, Term } from '@app/core';
import { TermCell } from './term-cell';

@Component({
  standalone: true,
  imports: [TermCell],
  template: `<app-term-cell [term]="term" [context]="context" />`,
})
class Host {
  term: Term | null = null;
  context: DisplayContext = { prefixes: {} };
}

function setup(term: Term, context: DisplayContext = { prefixes: {} }) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.term = term;
  fixture.componentInstance.context = context;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('TermCell', () => {
  it('renders a prefixed IRI as <prefix>:<local> with a kind data attribute', () => {
    const el = setup(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      { prefixes: { ex: 'http://example.org/' } },
    );
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('prefixed-iri');
    expect(cell?.textContent?.replace(/\s+/g, '')).toBe('ex:Foo');
  });

  it('renders an absolute IRI wrapped in angle brackets', () => {
    const el = setup({
      termType: 'NamedNode',
      value: 'http://other.example/x',
    });
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('absolute-iri');
    expect(cell?.textContent).toContain('<http://other.example/x>');
  });

  it('renders a base-relative IRI as <localname>', () => {
    const el = setup(
      { termType: 'NamedNode', value: 'http://example.org/Foo' },
      { prefixes: {}, base: 'http://example.org/' },
    );
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('base-iri');
    expect(cell?.textContent).toContain('<Foo>');
  });

  it('renders a plain literal in quotes', () => {
    const el = setup({ termType: 'Literal', value: 'hello' });
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('plain-literal');
    expect(cell?.textContent).toContain('"hello"');
  });

  it('renders a language-tagged literal with an @lang suffix', () => {
    const el = setup({ termType: 'Literal', value: 'bonjour', language: 'fr' });
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('language-literal');
    expect(cell?.textContent).toContain('"bonjour"');
    expect(cell?.textContent).toContain('@fr');
  });

  it('renders a numeric literal as bare lexical with kind=number', () => {
    const el = setup({
      termType: 'Literal',
      value: '42',
      datatype: { value: 'http://www.w3.org/2001/XMLSchema#integer' },
    });
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('number');
    expect(cell?.textContent?.trim()).toBe('42');
  });

  it('renders a typed literal with a ^^ datatype display', () => {
    const el = setup(
      {
        termType: 'Literal',
        value: '2024-01-01',
        datatype: { value: 'http://www.w3.org/2001/XMLSchema#date' },
      },
      { prefixes: { xsd: 'http://www.w3.org/2001/XMLSchema#' } },
    );
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('typed-literal');
    expect(cell?.textContent).toContain('"2024-01-01"');
    expect(cell?.textContent).toContain('xsd:date');
  });

  it('renders a blank node as _:label', () => {
    const el = setup({ termType: 'BlankNode', value: 'b0' });
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('blank');
    expect(cell?.textContent).toContain('_:b0');
  });

  it('renders nothing for a null term (unbound)', () => {
    const el = setup(null as unknown as Term);
    const cell = el.querySelector('[data-testid="term-cell"]');
    expect(cell?.getAttribute('data-kind')).toBe('unbound');
    expect(cell?.textContent?.trim()).toBe('');
  });
});
