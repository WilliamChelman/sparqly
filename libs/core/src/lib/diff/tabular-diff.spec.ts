import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { tabularDiff, type TabularDiffEntry, type TabularDiffResult } from './tabular-diff';
import type { TabularRow } from './tabular-row-key';

const { namedNode, literal, blankNode } = DataFactory;

const row = (obj: Record<string, string>): TabularRow => {
  const out: TabularRow = {};
  for (const [k, v] of Object.entries(obj)) out[k] = literal(v);
  return out;
};

function unwrap(
  result: ReturnType<typeof tabularDiff>,
): TabularDiffResult {
  if (result.isErr()) {
    throw new Error(
      `expected ok, got err: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

describe('tabularDiff — bag semantics', () => {
  it('is empty for two empty bags', () => {
    const r = unwrap(tabularDiff([], [], []));
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('is empty for identical single-variable rows', () => {
    const r = unwrap(
      tabularDiff([row({ id: 'a' })], [row({ id: 'a' })], ['id']),
    );
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('reports a row only on the right as added (count 1)', () => {
    const r = unwrap(tabularDiff([], [row({ id: 'a' })], ['id']));
    expect(r.removed).toEqual([]);
    expect(r.added).toHaveLength(1);
    expect(r.added[0].count).toBe(1);
    expect(r.added[0].row).toEqual({ id: literal('a') });
  });

  it('reports a row only on the left as removed (count 1)', () => {
    const r = unwrap(tabularDiff([row({ id: 'gone' })], [], ['id']));
    expect(r.added).toEqual([]);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].count).toBe(1);
  });

  it('surfaces net-positive count drift (3× left, 5× right → +2 added)', () => {
    const left = [row({ id: 'a' }), row({ id: 'a' }), row({ id: 'a' })];
    const right = [
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
    ];
    const r = unwrap(tabularDiff(left, right, ['id']));
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual<TabularDiffEntry[]>([
      { row: { id: literal('a') }, count: 2 },
    ]);
  });

  it('surfaces net-negative count drift (5× left, 3× right → -2 removed)', () => {
    const left = [
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
      row({ id: 'a' }),
    ];
    const right = [row({ id: 'a' }), row({ id: 'a' }), row({ id: 'a' })];
    const r = unwrap(tabularDiff(left, right, ['id']));
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual<TabularDiffEntry[]>([
      { row: { id: literal('a') }, count: 2 },
    ]);
  });

  it('handles mixed add+remove', () => {
    const left = [row({ id: 'gone' }), row({ id: 'kept' })];
    const right = [row({ id: 'kept' }), row({ id: 'new' })];
    const r = unwrap(tabularDiff(left, right, ['id']));
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].row).toEqual({ id: literal('gone') });
    expect(r.added).toHaveLength(1);
    expect(r.added[0].row).toEqual({ id: literal('new') });
  });
});

describe('tabularDiff — multi-variable + ordering', () => {
  it('treats two rows as equal when matched by variable name (set match), regardless of left/right projection order', () => {
    // Names match; the variables array should normalize ordering for keying.
    const left: TabularRow[] = [{ name: literal('alice'), age: literal('30') }];
    const right: TabularRow[] = [{ age: literal('30'), name: literal('alice') }];
    const r = unwrap(tabularDiff(left, right, ['name', 'age']));
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('sorts each block lexicographically by canonical key, regardless of input order', () => {
    const left: TabularRow[] = [];
    const right: TabularRow[] = [
      row({ id: 'c' }),
      row({ id: 'a' }),
      row({ id: 'b' }),
    ];
    const r = unwrap(tabularDiff(left, right, ['id']));
    const ids = r.added.map((e) => (e.row['id'] as { value: string }).value);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('treats unbound variables as a distinct row from any literal value', () => {
    const left: TabularRow[] = [{ x: undefined }];
    const right: TabularRow[] = [{ x: literal('') }];
    const r = unwrap(tabularDiff(left, right, ['x']));
    expect(r.added).toHaveLength(1);
    expect(r.removed).toHaveLength(1);
  });

  it('returns Result.err with a tabular-blank-node variant when any left row has a blank-node column', () => {
    const left: TabularRow[] = [{ x: blankNode('b0') }];
    const result = tabularDiff(left, [], ['x']);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({ kind: 'tabular-blank-node', column: 'x' });
    }
  });

  it('returns Result.err whether the offending row is on left or right', () => {
    const right: TabularRow[] = [{ id: blankNode('b1') }];
    const result = tabularDiff([], right, ['id']);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('tabular-blank-node');
      expect(result.error.column).toBe('id');
    }
  });

  it('handles named-node values (not just literals)', () => {
    const left: TabularRow[] = [
      { p: namedNode('http://example.org/a') },
    ];
    const right: TabularRow[] = [
      { p: namedNode('http://example.org/b') },
    ];
    const r = unwrap(tabularDiff(left, right, ['p']));
    expect(r.added).toHaveLength(1);
    expect(r.removed).toHaveLength(1);
  });
});
