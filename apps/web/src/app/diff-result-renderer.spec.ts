import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiffResultRenderer } from './diff-result-renderer';
import { SourceSnippet } from './source-snippet';
import type {
  DiffErrorResponse,
  DiffResponse,
  GraphDiffResponse,
  TabularDiffResponse,
} from './diff.service';

@Component({
  selector: 'app-source-snippet',
  standalone: true,
  template: `<div
    data-testid="snippet-stub"
    [attr.data-file]="file"
    [attr.data-line]="line"
    [attr.data-context]="context"
  ></div>`,
})
class SourceSnippetStub {
  @Input() file = '';
  @Input() line = 0;
  @Input() context = 0;
}

function render(result: DiffResponse, context = 3): HTMLElement {
  TestBed.configureTestingModule({ imports: [DiffResultRenderer] })
    .overrideComponent(DiffResultRenderer, {
      remove: { imports: [SourceSnippet] },
      add: { imports: [SourceSnippetStub] },
    });
  const fixture = TestBed.createComponent(DiffResultRenderer);
  fixture.componentRef.setInput('result', result);
  fixture.componentRef.setInput('context', context);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('DiffResultRenderer (graph mode)', () => {
  it('renders an added list and a removed list with one row per N-Quad line', () => {
    const result: GraphDiffResponse = {
      kind: 'graph',
      diff: {
        added: [
          '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
        ],
        removed: [
          '<http://example.org/c> <http://example.org/p> <http://example.org/d> .',
        ],
        totals: { left: 5, right: 6 },
      },
      sourceRecords: { left: {}, right: {} },
      totals: { left: 5, right: 6 },
    };
    const root = render(result);
    const added = root.querySelectorAll('[data-testid=added-line]');
    const removed = root.querySelectorAll('[data-testid=removed-line]');
    expect(added.length).toBe(1);
    expect(removed.length).toBe(1);
    expect(added[0].textContent).toContain('http://example.org/a');
    expect(removed[0].textContent).toContain('http://example.org/c');
  });

  it('shortens N-Quad lines using the default rdf/rdfs/owl/xsd prefixes', () => {
    const result: GraphDiffResponse = {
      kind: 'graph',
      diff: {
        added: [
          '<http://example.org/Foo> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .',
        ],
        removed: [],
        totals: { left: 0, right: 1 },
      },
      sourceRecords: { left: {}, right: {} },
      totals: { left: 0, right: 1 },
    };
    const root = render(result);
    const line = root.querySelector('[data-testid=added-line]');
    expect(line?.textContent).toContain('a owl:Class');
  });

  it('renders one SourceSnippet child per source record under each hunk line, forwarding the context input', () => {
    const addedKey =
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .';
    const removedKey =
      '<http://example.org/c> <http://example.org/p> <http://example.org/d> .';
    const result: GraphDiffResponse = {
      kind: 'graph',
      diff: {
        added: [addedKey],
        removed: [removedKey],
        totals: { left: 1, right: 1 },
      },
      sourceRecords: {
        left: {
          [removedKey]: [
            { file: 'file:///tmp/left.ttl', line: 12 },
            { file: 'file:///tmp/left.ttl', line: 18 },
          ],
        },
        right: {
          [addedKey]: [{ file: 'file:///tmp/right.ttl', line: 7 }],
        },
      },
      totals: { left: 1, right: 1 },
    };
    const root = render(result, 5);
    const snippets = Array.from(
      root.querySelectorAll('[data-testid=snippet-stub]'),
    ) as HTMLElement[];
    expect(snippets.length).toBe(3);
    const removedSn = snippets.filter(
      (p) => p.getAttribute('data-file') === 'file:///tmp/left.ttl',
    );
    expect(removedSn.length).toBe(2);
    expect(removedSn.map((p) => p.getAttribute('data-line'))).toEqual([
      '12',
      '18',
    ]);
    const addedSn = snippets.filter(
      (p) => p.getAttribute('data-file') === 'file:///tmp/right.ttl',
    );
    expect(addedSn.length).toBe(1);
    expect(addedSn[0].getAttribute('data-line')).toBe('7');
    expect(snippets.every((p) => p.getAttribute('data-context') === '5')).toBe(
      true,
    );
  });

  it('renders the canonical diff totals summary `# left=L right=R +x -y`', () => {
    const result: GraphDiffResponse = {
      kind: 'graph',
      diff: {
        added: [
          '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
          '<http://example.org/a> <http://example.org/p> <http://example.org/c> .',
        ],
        removed: [
          '<http://example.org/d> <http://example.org/p> <http://example.org/e> .',
        ],
        totals: { left: 4, right: 5 },
      },
      sourceRecords: { left: {}, right: {} },
      totals: { left: 4, right: 5 },
    };
    const root = render(result);
    const summary = root.querySelector('[data-testid=diff-totals]');
    expect(summary?.textContent).toContain('left=4 right=5 +2 -1');
  });
});

describe('DiffResultRenderer (tabular mode)', () => {
  it('renders a table with one row per added/removed entry, sided count column, and projected variables as headers', () => {
    const result: TabularDiffResponse = {
      kind: 'tabular',
      diff: {
        added: [
          {
            row: {
              s: { termType: 'NamedNode', value: 'http://example.org/a' },
              o: { termType: 'Literal', value: 'A' },
            },
            count: 2,
          },
        ],
        removed: [
          {
            row: {
              s: { termType: 'NamedNode', value: 'http://example.org/b' },
              o: { termType: 'Literal', value: 'B' },
            },
            count: 1,
          },
        ],
        totals: { left: 4, right: 5 },
      },
      totals: { left: 4, right: 5 },
      variables: ['s', 'o'],
    };
    const root = render(result);
    const table = root.querySelector('table[data-testid=tabular-diff]');
    expect(table).toBeTruthy();
    const headers = Array.from(
      table?.querySelectorAll('thead th') ?? [],
    ).map((th) => (th.textContent ?? '').trim());
    expect(headers).toEqual(['side', 'count', 's', 'o']);
    const rows = Array.from(
      table?.querySelectorAll('tbody tr') ?? [],
    ) as HTMLElement[];
    expect(rows.length).toBe(2);
    const sides = rows.map(
      (r) => r.querySelector('td[data-col=side]')?.textContent?.trim(),
    );
    expect(sides).toContain('-');
    expect(sides).toContain('+');
    const counts = rows.map(
      (r) => r.querySelector('td[data-col=count]')?.textContent?.trim(),
    );
    expect(counts.sort()).toEqual(['1', '2']);
  });

  it('renders the canonical diff totals summary in tabular mode', () => {
    const result: TabularDiffResponse = {
      kind: 'tabular',
      diff: {
        added: [
          {
            row: { x: { termType: 'Literal', value: '1' } },
            count: 3,
          },
        ],
        removed: [],
        totals: { left: 7, right: 10 },
      },
      totals: { left: 7, right: 10 },
      variables: ['x'],
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=diff-totals]')?.textContent).toContain(
      'left=7 right=10 +1 -0',
    );
  });
});

describe('DiffResultRenderer (error mode)', () => {
  it('renders left, right, and top error panels when all three are populated', () => {
    const result: DiffErrorResponse = {
      kind: 'error',
      errors: { left: 'left boom', right: 'right boom', top: 'top boom' },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=error-left]')?.textContent).toContain(
      'left boom',
    );
    expect(root.querySelector('[data-testid=error-right]')?.textContent).toContain(
      'right boom',
    );
    expect(root.querySelector('[data-testid=error-top]')?.textContent).toContain(
      'top boom',
    );
  });

  it('omits panels for empty error keys', () => {
    const result: DiffErrorResponse = {
      kind: 'error',
      errors: { top: 'shape mismatch' },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=error-left]')).toBeFalsy();
    expect(root.querySelector('[data-testid=error-right]')).toBeFalsy();
    expect(root.querySelector('[data-testid=error-top]')?.textContent).toContain(
      'shape mismatch',
    );
  });
});
