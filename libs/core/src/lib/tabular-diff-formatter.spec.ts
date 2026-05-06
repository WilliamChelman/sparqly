import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { formatTabularDiff } from './tabular-diff-formatter';
import type { TabularDiffResult } from './tabular-diff';

const { namedNode, literal } = DataFactory;

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
