import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiffResultRenderer } from './diff-result-renderer';
import { SourceSnippet } from './source-snippet';
import type {
  DiffErrorResponse,
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  HunkLine,
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
  TestBed.configureTestingModule({ imports: [DiffResultRenderer] }).overrideComponent(
    DiffResultRenderer,
    {
      remove: { imports: [SourceSnippet] },
      add: { imports: [SourceSnippetStub] },
    },
  );
  const fixture = TestBed.createComponent(DiffResultRenderer);
  fixture.componentRef.setInput('result', result);
  fixture.componentRef.setInput('context', context);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function makeLine(
  side: '-' | '+',
  subjectPath: string,
  predicate: string,
  object: string,
  nquad: string,
): HunkLine {
  return { side, subjectPath, predicate, object, nquad };
}

function emptyHunked(): GroupedDiffResponse {
  return {
    kind: 'grouped',
    hunked: { changed: [], removed: [], added: [], totals: { left: 0, right: 0 } },
  };
}

describe('DiffResultRenderer (grouped mode)', () => {
  it('renders the three sections in order: Changed, then Removed, then Added', () => {
    const root = render(emptyHunked());
    const sections = Array.from(
      root.querySelectorAll<HTMLElement>('section[data-testid^=section-]'),
    );
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'section-changed',
      'section-removed',
      'section-added',
    ]);
  });

  it('places each hunk under its section based on state', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [hunkChanged()],
        removed: [hunkRemoved()],
        added: [hunkAdded()],
        totals: { left: 2, right: 2 },
      },
    };
    const root = render(result);
    const changed = root.querySelectorAll(
      'section[data-testid=section-changed] [data-testid=hunk]',
    );
    const removed = root.querySelectorAll(
      'section[data-testid=section-removed] [data-testid=hunk]',
    );
    const added = root.querySelectorAll(
      'section[data-testid=section-added] [data-testid=hunk]',
    );
    expect(changed.length).toBe(1);
    expect(removed.length).toBe(1);
    expect(added.length).toBe(1);
  });

  it('renders each hunk header on two lines: title (anchor CURIE, rdf:type CURIE, [-N +M]) then chip row', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://www.w3.org/2002/07/owl#Thing',
            rdfType: 'http://www.w3.org/2000/01/rdf-schema#Class',
            state: 'changed',
            removed: 1,
            added: 1,
            lines: [
              makeLine(
                '-',
                'http://www.w3.org/2002/07/owl#Thing',
                'http://www.w3.org/2000/01/rdf-schema#label',
                '"old"',
                '<http://www.w3.org/2002/07/owl#Thing> <http://www.w3.org/2000/01/rdf-schema#label> "old" .',
              ),
              makeLine(
                '+',
                'http://www.w3.org/2002/07/owl#Thing',
                'http://www.w3.org/2000/01/rdf-schema#label',
                '"new"',
                '<http://www.w3.org/2002/07/owl#Thing> <http://www.w3.org/2000/01/rdf-schema#label> "new" .',
              ),
            ],
            sourceRecords: {
              left: [{ file: 'file:///tmp/left.ttl', line: 4 }],
              right: [{ file: 'file:///tmp/right.ttl', line: 9 }],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result);
    const header = root.querySelector(
      '[data-testid=hunk] [data-testid=hunk-header]',
    ) as HTMLElement | null;
    expect(header).toBeTruthy();
    const title = header?.querySelector('[data-testid=hunk-title]') as HTMLElement;
    expect(title.textContent).toContain('owl:Thing');
    expect(title.textContent).toContain('rdfs:Class');
    expect(title.textContent).toContain('[-1 +1]');
    const chips = header?.querySelector('[data-testid=hunk-chips]') as HTMLElement;
    expect(chips).toBeTruthy();
    const leftChip = chips.querySelector('[data-testid=hunk-chip-left]');
    const rightChip = chips.querySelector('[data-testid=hunk-chip-right]');
    expect(leftChip?.textContent).toContain('left.ttl:4');
    expect(rightChip?.textContent).toContain('right.ttl:9');
  });

  it('renders a paired -/+ for the same (subject-path, predicate) in a `[data-testid=hunk-pair]` group', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 1,
            added: 1,
            lines: [
              makeLine(
                '-',
                'http://example.org/a',
                'http://example.org/p',
                '<http://example.org/b>',
                '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
              ),
              makeLine(
                '+',
                'http://example.org/a',
                'http://example.org/p',
                '<http://example.org/c>',
                '<http://example.org/a> <http://example.org/p> <http://example.org/c> .',
              ),
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result);
    const pairs = root.querySelectorAll('[data-testid=hunk-pair]');
    expect(pairs.length).toBe(1);
    expect(pairs[0].querySelector('[data-testid=removed-line]')).toBeTruthy();
    expect(pairs[0].querySelector('[data-testid=added-line]')).toBeTruthy();
  });

  it('does not pair lines whose (subject-path, predicate) differ', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 1,
            added: 1,
            lines: [
              makeLine(
                '-',
                'http://example.org/a',
                'http://example.org/p',
                '<http://example.org/b>',
                '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
              ),
              makeLine(
                '+',
                'http://example.org/a',
                'http://example.org/q',
                '<http://example.org/c>',
                '<http://example.org/a> <http://example.org/q> <http://example.org/c> .',
              ),
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result);
    expect(root.querySelectorAll('[data-testid=hunk-pair]').length).toBe(0);
    expect(root.querySelectorAll('[data-testid=removed-line]').length).toBe(1);
    expect(root.querySelectorAll('[data-testid=added-line]').length).toBe(1);
  });

  it('wraps body in <details> with `Show N more` when a hunk has more than 20 lines, while keeping the header outside the details', () => {
    const lines: HunkLine[] = [];
    for (let i = 0; i < 22; i++) {
      lines.push(
        makeLine(
          '-',
          `http://example.org/a#${i}`,
          'http://example.org/p',
          `"v${i}"`,
          `<http://example.org/a> <http://example.org/p> "v${i}" .`,
        ),
      );
    }
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 22,
            added: 0,
            lines,
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 22, right: 0 },
      },
    };
    const root = render(result);
    const article = root.querySelector('[data-testid=hunk]') as HTMLElement;
    expect(article.querySelector('[data-testid=hunk-header]')).toBeTruthy();
    const details = article.querySelector('[data-testid=hunk-overflow]') as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details?.tagName.toLowerCase()).toBe('details');
    // The header lives OUTSIDE the <details> so it remains visible when collapsed.
    expect(details?.querySelector('[data-testid=hunk-header]')).toBeFalsy();
    expect(details?.querySelector('summary')?.textContent).toContain(
      'Show 22 more',
    );
    expect(details?.querySelectorAll('[data-testid=removed-line]').length).toBe(22);
  });

  it('does not wrap the body in <details> when the hunk has 20 or fewer lines', () => {
    const lines: HunkLine[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(
        makeLine(
          '-',
          `http://example.org/a#${i}`,
          'http://example.org/p',
          `"v${i}"`,
          `<http://example.org/a> <http://example.org/p> "v${i}" .`,
        ),
      );
    }
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 20,
            added: 0,
            lines,
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 20, right: 0 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=hunk-overflow]')).toBeFalsy();
    expect(root.querySelectorAll('[data-testid=removed-line]').length).toBe(20);
  });

  it('renders one snippet per unique (file, line) per hunk, with chips anchoring to that snippet via fragment id', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 1,
            added: 1,
            lines: [
              makeLine(
                '-',
                'http://example.org/a',
                'http://example.org/p',
                '<http://example.org/b>',
                '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
              ),
              makeLine(
                '+',
                'http://example.org/a',
                'http://example.org/p',
                '<http://example.org/c>',
                '<http://example.org/a> <http://example.org/p> <http://example.org/c> .',
              ),
            ],
            sourceRecords: {
              left: [
                { file: 'file:///tmp/left.ttl', line: 4 },
                { file: 'file:///tmp/left.ttl', line: 4 }, // duplicate (file,line)
              ],
              right: [{ file: 'file:///tmp/right.ttl', line: 9 }],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result, 5);
    const hunk = root.querySelector('[data-testid=hunk]') as HTMLElement;
    const snippets = Array.from(
      hunk.querySelectorAll<HTMLElement>('[data-testid=hunk-snippet]'),
    );
    // Two unique (file, line) tuples → two snippets.
    expect(snippets.length).toBe(2);
    const stubs = Array.from(
      hunk.querySelectorAll<HTMLElement>('[data-testid=snippet-stub]'),
    );
    expect(stubs.length).toBe(2);
    expect(stubs.every((s) => s.getAttribute('data-context') === '5')).toBe(true);
    const anchorIds = snippets.map((s) => s.getAttribute('data-anchor-id'));
    expect(new Set(anchorIds).size).toBe(2);
    // Chips link to those snippet anchor ids via fragment href.
    const chips = Array.from(
      hunk.querySelectorAll<HTMLAnchorElement>(
        '[data-testid^=hunk-chip-]',
      ),
    );
    const chipHrefIds = chips.map(
      (a) => (a.getAttribute('href') ?? '').replace(/^#/, ''),
    );
    for (const id of chipHrefIds) {
      expect(anchorIds).toContain(id);
    }
  });

  it('renders the canonical diff totals summary `# left=L right=R +x -y` derived from the hunked totals + hunk counts', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/a',
            state: 'changed',
            removed: 1,
            added: 2,
            lines: [
              makeLine('-', 'a', 'p', 'o', '<x> <p> "1" .'),
              makeLine('+', 'a', 'p', 'o', '<x> <p> "2" .'),
              makeLine('+', 'a', 'p', 'o', '<x> <p> "3" .'),
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 4, right: 5 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=diff-totals]')?.textContent).toContain(
      'left=4 right=5 +2 -1',
    );
  });

  it('shortens N-Quad lines using default rdf/rdfs/owl/xsd prefixes in the line body', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [],
        removed: [],
        added: [
          {
            anchor: 'http://example.org/Foo',
            state: 'added',
            removed: 0,
            added: 1,
            lines: [
              makeLine(
                '+',
                'http://example.org/Foo',
                'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
                '<http://www.w3.org/2002/07/owl#Class>',
                '<http://example.org/Foo> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .',
              ),
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        totals: { left: 0, right: 1 },
      },
    };
    const root = render(result);
    const line = root.querySelector('[data-testid=added-line]');
    expect(line?.textContent).toContain('owl:Class');
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
    const headers = Array.from(table?.querySelectorAll('thead th') ?? []).map(
      (th) => (th.textContent ?? '').trim(),
    );
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

function hunkChanged(): Hunk {
  return {
    anchor: 'http://example.org/changed',
    state: 'changed',
    removed: 1,
    added: 1,
    lines: [
      makeLine(
        '-',
        'http://example.org/changed',
        'http://example.org/p',
        '"a"',
        '<http://example.org/changed> <http://example.org/p> "a" .',
      ),
      makeLine(
        '+',
        'http://example.org/changed',
        'http://example.org/p',
        '"b"',
        '<http://example.org/changed> <http://example.org/p> "b" .',
      ),
    ],
    sourceRecords: { left: [], right: [] },
  };
}

function hunkRemoved(): Hunk {
  return {
    anchor: 'http://example.org/gone',
    state: 'removed',
    removed: 1,
    added: 0,
    lines: [
      makeLine(
        '-',
        'http://example.org/gone',
        'http://example.org/p',
        '"x"',
        '<http://example.org/gone> <http://example.org/p> "x" .',
      ),
    ],
    sourceRecords: { left: [], right: [] },
  };
}

function hunkAdded(): Hunk {
  return {
    anchor: 'http://example.org/new',
    state: 'added',
    removed: 0,
    added: 1,
    lines: [
      makeLine(
        '+',
        'http://example.org/new',
        'http://example.org/p',
        '"y"',
        '<http://example.org/new> <http://example.org/p> "y" .',
      ),
    ],
    sourceRecords: { left: [], right: [] },
  };
}
