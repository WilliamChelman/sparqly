import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { formatTabularDiff } from './tabular-diff-formatter';
import type { TabularDiffResult } from './tabular-diff';

const { namedNode, literal } = DataFactory;

function extractTable(html: string, section: 'removed' | 'added'): string {
  const re = new RegExp(
    `<section class="block ${section}">[\\s\\S]*?</section>`,
  );
  const m = html.match(re);
  if (m === null) throw new Error(`section ${section} not found`);
  return m[0];
}

describe('formatTabularDiff — human format', () => {
  it('renders an added row with sorted variable keys and elides (×1)', () => {
    const diff: TabularDiffResult = {
      added: [
        { row: { name: literal('alice'), age: literal('30') }, count: 1 },
      ],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['name', 'age'] });
    expect(out).toBe('+ {?age="30", ?name="alice"}\n');
  });

  it('renders a removed row prefixed with `- `', () => {
    const diff: TabularDiffResult = {
      added: [],
      removed: [{ row: { id: literal('gone') }, count: 1 }],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['id'] });
    expect(out).toBe('- {?id="gone"}\n');
  });

  it('appends a trailing (×N) when count > 1', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('a') }, count: 3 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['id'] });
    expect(out).toBe('+ {?id="a"} (×3)\n');
  });

  it('emits removed lines before added lines, mirroring graph-diff human ordering', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('new') }, count: 1 }],
      removed: [{ row: { id: literal('gone') }, count: 1 }],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['id'] });
    expect(out).toBe('- {?id="gone"}\n+ {?id="new"}\n');
  });

  it('renders unbound bindings as `UNBOUND` (no quotes)', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { x: undefined }, count: 1 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['x'] });
    expect(out).toBe('+ {?x=UNBOUND}\n');
  });

  it('renders a named-node binding with angle brackets', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { p: namedNode('http://example.org/a') }, count: 1 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'human', { variables: ['p'] });
    expect(out).toBe('+ {?p=<http://example.org/a>}\n');
  });
});

describe('formatTabularDiff — json format', () => {
  it('emits {added, removed, vars} preserving the supplied variable order', () => {
    const diff: TabularDiffResult = {
      added: [
        { row: { name: literal('alice'), age: literal('30') }, count: 1 },
      ],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'json', {
      variables: ['name', 'age'],
    });
    const parsed = JSON.parse(out);
    expect(parsed.vars).toEqual(['name', 'age']);
    expect(parsed.removed).toEqual([]);
    expect(parsed.added).toHaveLength(1);
    // count: 1 elided
    expect(parsed.added[0].count).toBeUndefined();
    expect(parsed.added[0].row.name).toMatchObject({
      termType: 'Literal',
      value: 'alice',
    });
    expect(parsed.added[0].row.age).toMatchObject({
      termType: 'Literal',
      value: '30',
    });
  });

  it('keeps an explicit `count` when > 1', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('a') }, count: 4 }],
      removed: [],
    };
    const parsed = JSON.parse(
      formatTabularDiff(diff, 'json', { variables: ['id'] }),
    );
    expect(parsed.added[0].count).toBe(4);
  });

  it('round-trips lang/datatype literals without lossy collapse', () => {
    const diff: TabularDiffResult = {
      added: [
        {
          row: {
            greeting: literal('hello', 'en'),
            age: literal(
              '30',
              namedNode('http://www.w3.org/2001/XMLSchema#integer'),
            ),
          },
          count: 1,
        },
      ],
      removed: [],
    };
    const parsed = JSON.parse(
      formatTabularDiff(diff, 'json', { variables: ['greeting', 'age'] }),
    );
    expect(parsed.added[0].row.greeting).toMatchObject({
      termType: 'Literal',
      value: 'hello',
      language: 'en',
    });
    expect(parsed.added[0].row.age).toMatchObject({
      termType: 'Literal',
      value: '30',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    });
  });
});

describe('formatTabularDiff — html format', () => {
  it('renders a self-contained doc with two tables (removed before added) and a count column', () => {
    const diff: TabularDiffResult = {
      added: [
        { row: { name: literal('alice'), age: literal('30') }, count: 1 },
      ],
      removed: [{ row: { name: literal('bob'), age: literal('40') }, count: 1 }],
    };
    const out = formatTabularDiff(diff, 'html', {
      variables: ['name', 'age'],
    });

    // self-contained shell — same shape as composeHtmlDiff
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<style>');
    expect(out).not.toMatch(/<script\b/);
    expect(out).not.toMatch(/<link\b/);
    expect(out).toContain('<h1>sparqly diff</h1>');
    expect(out).toContain('+1 −1');

    const removed = extractTable(out, 'removed');
    expect(removed).toContain('<h2>Removed</h2>');
    expect(removed).toContain('<th>?name</th>');
    expect(removed).toContain('<th>?age</th>');
    expect(removed).toContain('<th>count</th>');
    expect(removed).toContain('<td>&quot;bob&quot;</td>');
    expect(removed).toContain('<td>&quot;40&quot;</td>');

    const added = extractTable(out, 'added');
    expect(added).toContain('<h2>Added</h2>');
    expect(added).toContain('<td>&quot;alice&quot;</td>');
    expect(added).toContain('<td>&quot;30&quot;</td>');
  });

  it('renders the count column as `1` for single-occurrence rows (no elision in tabular html)', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('a') }, count: 1 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'html', { variables: ['id'] });
    const added = extractTable(out, 'added');
    expect(added).toContain('<td class="count">1</td>');
  });

  it('renders the count column as N for multiplicity drift (e.g. 2)', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('a') }, count: 2 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'html', { variables: ['id'] });
    const added = extractTable(out, 'added');
    expect(added).toContain('<td class="count">2</td>');
  });

  it('renders an empty block as `(none)` placeholder rather than an empty table', () => {
    const diff: TabularDiffResult = {
      added: [{ row: { id: literal('a') }, count: 1 }],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'html', { variables: ['id'] });
    const removed = extractTable(out, 'removed');
    expect(removed).toContain('<p class="empty">(none)</p>');
    expect(removed).not.toContain('<table');

    const added = extractTable(out, 'added');
    expect(added).toContain('<table');
  });

  it('escapes HTML-significant characters in term values (no raw < or & in output)', () => {
    const diff: TabularDiffResult = {
      added: [
        {
          row: { x: literal('<script>&"alert("x")"') },
          count: 1,
        },
      ],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'html', { variables: ['x'] });
    const added = extractTable(out, 'added');
    // The term value's literal payload must be escaped — check no raw `<script` lands in a <td>
    const cell = added.match(/<tr class="row added">[\s\S]*?<td>([\s\S]*?)<\/td>/);
    if (cell === null) throw new Error('expected a cell match');
    expect(cell[1]).not.toContain('<script');
    expect(cell[1]).toContain('&lt;script&gt;');
    expect(cell[1]).toContain('&amp;');
  });

  it('preserves the supplied variable order in <th> headers and <td> cells', () => {
    const diff: TabularDiffResult = {
      added: [
        {
          row: { name: literal('alice'), age: literal('30'), id: literal('1') },
          count: 1,
        },
      ],
      removed: [],
    };
    const out = formatTabularDiff(diff, 'html', {
      // intentionally non-alphabetical to expose accidental sorting
      variables: ['id', 'name', 'age'],
    });
    const added = extractTable(out, 'added');

    // <th> in supplied order, then count last
    const headRow = added.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/);
    if (headRow === null) throw new Error('expected a thead match');
    expect(headRow[1]).toBe(
      '<th>?id</th><th>?name</th><th>?age</th><th>count</th>',
    );

    // <td> in same order
    const bodyRow = added.match(
      /<tr class="row added">([\s\S]*?)<\/tr>/,
    );
    if (bodyRow === null) throw new Error('expected a tbody row match');
    expect(bodyRow[1]).toBe(
      '<td>&quot;1&quot;</td><td>&quot;alice&quot;</td><td>&quot;30&quot;</td><td class="count">1</td>',
    );
  });
});
