import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiffResultRendererComponent } from './diff-result-renderer.component';
import { SourceSnippetComponent } from './source-snippet.component';
import type {
  DiffErrorResponse,
  DiffResponse,
  GroupedDiffResponse,
  Hunk,
  HunkLine,
  TabularDiffResponse,
} from '../services/diff.service';

@Component({
  selector: 'app-source-snippet',
  standalone: true,
  template: `<div
    data-testid="snippet-stub"
    [attr.data-file]="file"
    [attr.data-focal-start]="focalStart"
    [attr.data-focal-end]="focalEnd"
    [attr.data-context]="context"
  ></div>`,
})
class SourceSnippetStub {
  @Input() file = '';
  @Input() focalStart = 0;
  @Input() focalEnd = 0;
  @Input() context = 0;
}

function render(result: DiffResponse, context = 3): HTMLElement {
  TestBed.configureTestingModule({
    imports: [DiffResultRendererComponent],
  }).overrideComponent(DiffResultRendererComponent, {
    remove: { imports: [SourceSnippetComponent] },
    add: { imports: [SourceSnippetStub] },
  });
  const fixture = TestBed.createComponent(DiffResultRendererComponent);
  fixture.componentRef.setInput('result', result);
  fixture.componentRef.setInput('context', context);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function makeLine(side: '-' | '+', subjectPath: string, predicate: string): HunkLine {
  return {
    side,
    subjectPath,
    predicate,
    object: '"x"',
    nquad: `<${subjectPath}> <${predicate}> "x" .`,
  };
}

function emptyHunked(): GroupedDiffResponse {
  return {
    kind: 'grouped',
    hunked: { changed: [], removed: [], added: [], totals: { left: 0, right: 0 } },
  };
}

function changedHunk(): Hunk {
  return {
    anchor: 'http://example.org/changed',
    state: 'changed',
    removed: 1,
    added: 1,
    lines: [
      makeLine('-', 'http://example.org/changed', 'http://example.org/p'),
      makeLine('+', 'http://example.org/changed', 'http://example.org/p'),
    ],
    sourceRecords: { left: [], right: [] },
  };
}

function removedHunk(): Hunk {
  return {
    anchor: 'http://example.org/gone',
    state: 'removed',
    removed: 1,
    added: 0,
    lines: [makeLine('-', 'http://example.org/gone', 'http://example.org/p')],
    sourceRecords: { left: [], right: [] },
  };
}

function addedHunk(): Hunk {
  return {
    anchor: 'http://example.org/new',
    state: 'added',
    removed: 0,
    added: 1,
    lines: [makeLine('+', 'http://example.org/new', 'http://example.org/p')],
    sourceRecords: { left: [], right: [] },
  };
}

describe('DiffResultRendererComponent (grouped mode)', () => {
  it('renders the totals strip with `+N -M` derived from hunked totals and line distribution', () => {
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
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

  it('renders three sections in order: Changed, Added, Removed', () => {
    const root = render(emptyHunked());
    const sections = Array.from(
      root.querySelectorAll<HTMLElement>('section[data-testid^=section-]'),
    );
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'section-changed',
      'section-added',
      'section-removed',
    ]);
  });

  it('classifies hunks via the classifier, not via server-provided hunked.{changed,added,removed} buckets', () => {
    // Server-provided buckets are intentionally swapped: the "added" bucket
    // contains a hunk whose lines are all `-` (so should classify as removed),
    // and vice versa. The renderer must trust the classifier.
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [],
        // server says "removed" but lines are all `+` → classifier says "added"
        removed: [
          {
            anchor: 'http://example.org/should-be-added',
            state: 'removed',
            removed: 0,
            added: 1,
            lines: [makeLine('+', 'http://example.org/x', 'http://example.org/p')],
            sourceRecords: { left: [], right: [] },
          },
        ],
        // server says "added" but lines are all `-` → classifier says "removed"
        added: [
          {
            anchor: 'http://example.org/should-be-removed',
            state: 'added',
            removed: 1,
            added: 0,
            lines: [makeLine('-', 'http://example.org/y', 'http://example.org/p')],
            sourceRecords: { left: [], right: [] },
          },
        ],
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result);
    const addedHunks = root.querySelectorAll(
      'section[data-testid=section-added] [data-testid=hunk]',
    );
    const removedHunks = root.querySelectorAll(
      'section[data-testid=section-removed] [data-testid=hunk]',
    );
    expect(addedHunks.length).toBe(1);
    expect(addedHunks[0].textContent).toContain('should-be-added');
    expect(removedHunks.length).toBe(1);
    expect(removedHunks[0].textContent).toContain('should-be-removed');
  });

  it('shows section counts in each section head', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [changedHunk(), changedHunk()],
        removed: [removedHunk()],
        added: [addedHunk(), addedHunk(), addedHunk()],
        totals: { left: 3, right: 5 },
      },
    };
    const root = render(result);
    const changedHead = root.querySelector(
      'section[data-testid=section-changed] [data-testid=section-count]',
    );
    const addedHead = root.querySelector(
      'section[data-testid=section-added] [data-testid=section-count]',
    );
    const removedHead = root.querySelector(
      'section[data-testid=section-removed] [data-testid=section-count]',
    );
    expect(changedHead?.textContent).toContain('2');
    expect(addedHead?.textContent).toContain('3');
    expect(removedHead?.textContent).toContain('1');
  });

  it('renders per-hunk anchor chips for each source record', () => {
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
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
    const chips = root.querySelector('[data-testid=hunk-chips]') as HTMLElement;
    expect(chips).toBeTruthy();
    const leftChip = chips.querySelector('[data-testid=hunk-chip-left]');
    const rightChip = chips.querySelector('[data-testid=hunk-chip-right]');
    expect(leftChip?.textContent).toContain('left.ttl:4');
    expect(rightChip?.textContent).toContain('right.ttl:9');
  });

  it('renders compact `predicate ( item1 item2 )` for hunk lines that carry listItems, shortening item IRIs via the active prefixes', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [
          {
            anchor: 'http://example.org/Alice',
            state: 'changed',
            removed: 1,
            added: 1,
            lines: [
              {
                side: '-',
                subjectPath: 'http://example.org/Alice',
                predicate: 'http://example.org/friends',
                object: '( <http://example.org/Bob> <http://example.org/Carl> )',
                nquad:
                  '<http://example.org/Alice> <http://example.org/friends> ( <http://example.org/Bob> <http://example.org/Carl> ) .',
                listItems: [
                  '<http://example.org/Bob>',
                  '<http://example.org/Carl>',
                ],
              },
              {
                side: '+',
                subjectPath: 'http://example.org/Alice',
                predicate: 'http://example.org/friends',
                object:
                  '( <http://example.org/Bob> <http://example.org/Carl> <http://example.org/Donald> )',
                nquad:
                  '<http://example.org/Alice> <http://example.org/friends> ( <http://example.org/Bob> <http://example.org/Carl> <http://example.org/Donald> ) .',
                listItems: [
                  '<http://example.org/Bob>',
                  '<http://example.org/Carl>',
                  '<http://example.org/Donald>',
                ],
              },
            ],
            sourceRecords: { left: [], right: [] },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 0, right: 0 },
      },
    };

    TestBed.configureTestingModule({
      imports: [DiffResultRendererComponent],
    }).overrideComponent(DiffResultRendererComponent, {
      remove: { imports: [SourceSnippetComponent] },
      add: { imports: [SourceSnippetStub] },
    });
    const fixture = TestBed.createComponent(DiffResultRendererComponent);
    fixture.componentRef.setInput('result', result);
    fixture.componentRef.setInput('displayContext', {
      prefixes: { ex: 'http://example.org/' },
    });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    const minus = root.querySelector('[data-testid=removed-line]')?.textContent ?? '';
    const plus = root.querySelector('[data-testid=added-line]')?.textContent ?? '';
    expect(minus).toContain('ex:friends ( ex:Bob ex:Carl )');
    expect(plus).toContain('ex:friends ( ex:Bob ex:Carl ex:Donald )');
    // The raw bnode object form must NOT leak through.
    expect(minus).not.toContain('_:');
    expect(plus).not.toContain('_:');
  });

  it('absorbs records whose [start..end] range is fully enclosed by a sibling parent range on the same side', () => {
    // Parent range L11..L16 (e.g. a multi-line `( … )` list) on the left.
    // Inner per-item rdf:first records L12..L12, L13..L13, L14..L14 should
    // collapse into the parent — only one snippet renders for that side.
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
            ],
            sourceRecords: {
              left: [
                { file: 'file:///tmp/a.ttl', line: 11, endLine: 16 },
                { file: 'file:///tmp/a.ttl', line: 12 },
                { file: 'file:///tmp/a.ttl', line: 13 },
                { file: 'file:///tmp/a.ttl', line: 14 },
              ],
              right: [],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 4, right: 0 },
      },
    };
    const root = render(result);
    const stubs = Array.from(
      root.querySelectorAll('[data-testid=snippet-stub]'),
    ) as HTMLElement[];
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute('data-focal-start')).toBe('11');
    expect(stubs[0].getAttribute('data-focal-end')).toBe('16');
  });

  it('merges adjacent same-side source records into one snippet whose anchor markers cover every original line', () => {
    // Three single-line left records on lines 17, 18, 19 with the default
    // context=3: their snippet windows would already overlap, so the
    // renderer collapses them into one source-snippet block while
    // keeping per-line anchor markers so chips still navigate.
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
            ],
            sourceRecords: {
              left: [
                { file: 'file:///tmp/a.ttl', line: 17 },
                { file: 'file:///tmp/a.ttl', line: 18 },
                { file: 'file:///tmp/a.ttl', line: 19 },
              ],
              right: [],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 3, right: 0 },
      },
    };
    const root = render(result);
    const stubs = Array.from(
      root.querySelectorAll('[data-testid=snippet-stub]'),
    ) as HTMLElement[];
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute('data-focal-start')).toBe('17');
    expect(stubs[0].getAttribute('data-focal-end')).toBe('19');
    expect(root.querySelector('#a\\.ttl-L17')).toBeTruthy();
    expect(root.querySelector('#a\\.ttl-L18')).toBeTruthy();
    expect(root.querySelector('#a\\.ttl-L19')).toBeTruthy();
  });

  it('keeps non-adjacent same-side source records as separate snippets when their gap exceeds the context window', () => {
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
            ],
            sourceRecords: {
              left: [
                { file: 'file:///tmp/a.ttl', line: 17 },
                { file: 'file:///tmp/a.ttl', line: 22 },
              ],
              right: [],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 2, right: 0 },
      },
    };
    const root = render(result, /* context */ 3);
    const stubs = Array.from(
      root.querySelectorAll('[data-testid=snippet-stub]'),
    ) as HTMLElement[];
    expect(stubs.length).toBe(2);
  });

  it('renders a snippet with focalStart=focalEnd for single-line records', () => {
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
              makeLine('-', 'http://example.org/a', 'http://example.org/p'),
              makeLine('+', 'http://example.org/a', 'http://example.org/p'),
            ],
            sourceRecords: {
              left: [{ file: 'file:///tmp/a.ttl', line: 7 }],
              right: [],
            },
          },
        ],
        removed: [],
        added: [],
        totals: { left: 1, right: 0 },
      },
    };
    const root = render(result);
    const stub = root.querySelector(
      '[data-testid=snippet-stub]',
    ) as HTMLElement | null;
    expect(stub).toBeTruthy();
    expect(stub?.getAttribute('data-focal-start')).toBe('7');
    expect(stub?.getAttribute('data-focal-end')).toBe('7');
  });

  it('renders empty section copy "(none)" when a section has no hunks', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        changed: [],
        removed: [],
        added: [addedHunk()],
        totals: { left: 0, right: 1 },
      },
    };
    const root = render(result);
    expect(
      root.querySelector(
        'section[data-testid=section-changed] [data-testid=section-empty]',
      )?.textContent,
    ).toContain('(none)');
    expect(
      root.querySelector(
        'section[data-testid=section-removed] [data-testid=section-empty]',
      ),
    ).toBeTruthy();
    expect(
      root.querySelector(
        'section[data-testid=section-added] [data-testid=section-empty]',
      ),
    ).toBeFalsy();
  });
});

describe('DiffResultRendererComponent (tabular mode)', () => {
  it('renders a tabular table with one row per added/removed entry, side cell, count, and variable headers', () => {
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
    const sides = rows.map((r) => r.getAttribute('data-side'));
    expect(sides).toContain('+');
    expect(sides).toContain('-');
  });

  it('renders the totals strip in tabular mode', () => {
    const result: TabularDiffResponse = {
      kind: 'tabular',
      diff: {
        added: [
          { row: { x: { termType: 'Literal', value: '1' } }, count: 3 },
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

describe('DiffResultRendererComponent (error mode)', () => {
  it('renders error panels when the response is an error', () => {
    const result: DiffErrorResponse = {
      kind: 'error',
      errors: { left: 'left boom', right: 'right boom', top: 'top boom' },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=error-top]')?.textContent).toContain(
      'top boom',
    );
    expect(root.querySelector('[data-testid=error-left]')?.textContent).toContain(
      'left boom',
    );
    expect(root.querySelector('[data-testid=error-right]')?.textContent).toContain(
      'right boom',
    );
  });
});
