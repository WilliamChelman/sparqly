import { TestBed } from '@angular/core/testing';
import { DiffHunkComponent } from './diff-hunk.component';
import type { Hunk, HunkLine } from '../services/diff.service';
import type { HunkClass } from '../utils/hunk-classifier';

const EX = 'http://example.org/';

function line(side: '-' | '+', predicate: string, object: string): HunkLine {
  return {
    side,
    subjectPath: `${EX}alice`,
    predicate: `${EX}${predicate}`,
    object,
    nquad: `<${EX}alice> <${EX}${predicate}> ${object} .`,
  };
}

function hunk(overrides: Partial<Hunk> = {}): Hunk {
  return {
    anchor: `${EX}alice`,
    state: 'changed',
    removed: 1,
    added: 1,
    lines: [line('+', 'name', '"Alice"')],
    sourceRecords: { left: [], right: [] },
    ...overrides,
  };
}

function render(h: Hunk, cls: HunkClass = 'changed'): HTMLElement {
  TestBed.configureTestingModule({ imports: [DiffHunkComponent] });
  const fixture = TestBed.createComponent(DiffHunkComponent);
  fixture.componentRef.setInput('hunk', h);
  fixture.componentRef.setInput('cls', cls);
  fixture.componentRef.setInput('displayContext', { prefixes: { ex: EX } });
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DiffHunkComponent — entity-hunk line highlighting', () => {
  it('syntax-highlights an entity-hunk line body with the turtle mode', () => {
    const root = render(hunk());

    const body = root.querySelector('[data-testid=hunk-body]');
    expect(body?.classList.contains('cm-s-sparqly')).toBe(true);

    const added = root.querySelector('[data-testid=added-line]');
    expect(added?.querySelector('span.cm-string')?.textContent).toBe('"Alice"');
  });

  it('keeps the +/- change marker a plain text prefix outside the highlighted tokens', () => {
    const root = render(
      hunk({
        lines: [line('-', 'name', '"Alice"'), line('+', 'name', '"Bob"')],
      }),
    );

    const removed = root.querySelector('[data-testid=removed-line]');
    const added = root.querySelector('[data-testid=added-line]');

    expect(removed?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(removed?.firstChild?.textContent).toBe('- ');
    expect(added?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(added?.firstChild?.textContent).toBe('+ ');

    for (const el of [removed, added]) {
      const tokens = Array.from(el?.querySelectorAll('[class^=cm-]') ?? []);
      for (const token of tokens) {
        expect(token.textContent).not.toMatch(/[-+]/);
      }
    }
  });

  it('preserves the added/removed line background colors through highlighting', () => {
    const root = render(
      hunk({
        lines: [line('-', 'name', '"Alice"'), line('+', 'name', '"Bob"')],
      }),
    );

    const removed = root.querySelector('[data-testid=removed-line]');
    const added = root.querySelector('[data-testid=added-line]');

    expect(removed?.classList.contains('bg-removed-bg')).toBe(true);
    expect(added?.classList.contains('bg-added-bg')).toBe(true);
  });

  it('keeps the displayed change-line text byte-identical to the un-highlighted fragment', () => {
    const root = render(
      hunk({
        lines: [
          line('-', 'name', '"Alice"@en'),
          line('+', 'name', '"Bob"'),
        ],
      }),
    );

    expect(
      root.querySelector('[data-testid=removed-line]')?.textContent,
    ).toBe('- ex:name "Alice"@en .');
    expect(root.querySelector('[data-testid=added-line]')?.textContent).toBe(
      '+ ex:name "Bob" .',
    );
  });
});
