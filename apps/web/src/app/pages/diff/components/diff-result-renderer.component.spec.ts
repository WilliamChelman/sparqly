import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DiffHunkComponent } from './diff-hunk.component';
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

function stubSnippetComponent(): void {
  TestBed.overrideComponent(DiffHunkComponent, {
    remove: { imports: [SourceSnippetComponent] },
    add: { imports: [SourceSnippetStub] },
  });
}

function render(result: DiffResponse, context = 3): HTMLElement {
  TestBed.configureTestingModule({
    imports: [DiffResultRendererComponent],
  });
  stubSnippetComponent();
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
    hunked: { hunks: [], totals: { left: 0, right: 0 } },
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
        hunks: [
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
        totals: { left: 4, right: 5 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=diff-totals]')?.textContent).toContain(
      'left=4 right=5 +2 -1',
    );
  });

  it('renders all hunks in a single flat list with no section wrappers', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [changedHunk(), removedHunk(), addedHunk()],
        totals: { left: 2, right: 2 },
      },
    };
    const root = render(result);

    // No section wrappers anywhere in the rendered tree.
    expect(
      root.querySelectorAll('[data-testid^=section-]').length,
    ).toBe(0);

    // All three hunks are rendered as direct children of one flat list.
    const list = root.querySelector('[data-testid=hunk-list]');
    expect(list).toBeTruthy();
    const hunks = list?.querySelectorAll('[data-testid=hunk]') ?? [];
    expect(hunks.length).toBe(3);
  });

  it('tags each hunk with the classifier-derived state, not the server-provided state', () => {
    // The hunks' server-provided `state` is intentionally wrong: the first
    // hunk's lines are all `+` (so should classify as added) yet it says
    // "removed", and vice versa. The renderer must trust the classifier when
    // stamping each hunk's data-state.
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
          // server says "removed" but lines are all `+` → classifier says "added"
          {
            anchor: 'http://example.org/should-be-added',
            state: 'removed',
            removed: 0,
            added: 1,
            lines: [makeLine('+', 'http://example.org/x', 'http://example.org/p')],
            sourceRecords: { left: [], right: [] },
          },
          // server says "added" but lines are all `-` → classifier says "removed"
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
    const hunks = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid=hunk-list] [data-testid=hunk]'),
    );
    const byAnchor = new Map(
      hunks.map((h) => [h.textContent ?? '', h.getAttribute('data-state')]),
    );
    const addedEl = hunks.find((h) => h.textContent?.includes('should-be-added'));
    const removedEl = hunks.find((h) => h.textContent?.includes('should-be-removed'));
    expect(addedEl?.getAttribute('data-state')).toBe('added');
    expect(removedEl?.getAttribute('data-state')).toBe('removed');
    expect(byAnchor.size).toBe(2);
  });

  it('renders a right-side placeholder when a hunk has only left source records', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
          {
            anchor: 'http://example.org/gone',
            state: 'removed',
            removed: 1,
            added: 0,
            lines: [makeLine('-', 'http://example.org/gone', 'http://example.org/p')],
            sourceRecords: {
              left: [{ file: 'file:///tmp/left.ttl', line: 5 }],
              right: [],
            },
          },
        ],
        totals: { left: 1, right: 0 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-right]')).toBeTruthy();
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-left]')).toBeFalsy();
    // The actual left snippet still renders.
    expect(root.querySelectorAll('[data-testid=snippet-stub]').length).toBe(1);
  });

  it('renders a left-side placeholder when a hunk has only right source records', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
          {
            anchor: 'http://example.org/new',
            state: 'added',
            removed: 0,
            added: 1,
            lines: [makeLine('+', 'http://example.org/new', 'http://example.org/p')],
            sourceRecords: {
              left: [],
              right: [{ file: 'file:///tmp/right.ttl', line: 9 }],
            },
          },
        ],
        totals: { left: 0, right: 1 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-left]')).toBeTruthy();
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-right]')).toBeFalsy();
    expect(root.querySelectorAll('[data-testid=snippet-stub]').length).toBe(1);
  });

  it('renders no placeholders when both sides have source records', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
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
        totals: { left: 1, right: 1 },
      },
    };
    const root = render(result);
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-left]')).toBeFalsy();
    expect(root.querySelector('[data-testid=hunk-snippet-placeholder-right]')).toBeFalsy();
  });

  it('renders compact `predicate ( item1 item2 )` for hunk lines that carry listItems, shortening item IRIs via the active prefixes', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
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
        totals: { left: 0, right: 0 },
      },
    };

    TestBed.configureTestingModule({
      imports: [DiffResultRendererComponent],
    });
    stubSnippetComponent();
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
        hunks: [
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

  it('merges adjacent same-side source records into one snippet covering every original line', () => {
    // Three single-line left records on lines 17, 18, 19 with the default
    // context=3: their snippet windows would already overlap, so the
    // renderer collapses them into one source-snippet block.
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
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
  });

  it('keeps non-adjacent same-side source records as separate snippets when their gap exceeds the context window', () => {
    const result: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [
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
        hunks: [
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

  it('renders an empty placeholder when the grouped result has no hunks', () => {
    const root = render(emptyHunked());
    expect(root.querySelector('[data-testid=hunk-list-empty]')).toBeTruthy();
  });

  it('omits the empty placeholder when at least one hunk is present', () => {
    const populated: GroupedDiffResponse = {
      kind: 'grouped',
      hunked: {
        hunks: [addedHunk()],
        totals: { left: 0, right: 1 },
      },
    };
    const root = render(populated);
    expect(root.querySelector('[data-testid=hunk-list-empty]')).toBeFalsy();
    expect(
      root.querySelectorAll('[data-testid=hunk-list] [data-testid=hunk]').length,
    ).toBe(1);
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

  it('attaches a "describe this" affordance to NamedNode cells but not to literals', () => {
    const result: TabularDiffResponse = {
      kind: 'tabular',
      diff: {
        added: [
          {
            row: {
              s: { termType: 'NamedNode', value: 'http://example.org/a' },
              o: { termType: 'Literal', value: 'A' },
            },
            count: 1,
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
        totals: { left: 1, right: 1 },
      },
      totals: { left: 1, right: 1 },
      variables: ['s', 'o'],
    };
    const root = render(result);
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[data-testid="describe-this"]'),
    ).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      `/describe?iri=${encodeURIComponent('http://example.org/a')}`,
      `/describe?iri=${encodeURIComponent('http://example.org/b')}`,
    ]);
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
