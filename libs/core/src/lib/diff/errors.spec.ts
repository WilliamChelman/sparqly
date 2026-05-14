import { describe, expect, it } from 'vitest';
import { formatDiffError, type DiffError } from './errors';

describe('formatDiffError', () => {
  it('passes through wrapped messages verbatim for anonymous/legacy variants', () => {
    expect(
      formatDiffError({
        kind: 'anonymous-view-execution',
        side: 'left',
        message: 'parse failed at line 1',
      }),
    ).toBe('parse failed at line 1');
    expect(
      formatDiffError({
        kind: 'legacy-message',
        message: 'unknown @id "foo" on left side',
      }),
    ).toBe('unknown @id "foo" on left side');
  });

  it('produces a non-empty message for every DiffError variant', () => {
    const variants: ReadonlyArray<DiffError> = [
      { kind: 'tabular-blank-node', column: 'x' },
      {
        kind: 'target',
        side: 'left',
        target: { kind: 'unknown-ref', ref: '@nope', availableIds: ['a'] },
      },
      { kind: 'mixed-shape', triplesSide: 'left', tuplesSide: 'right' },
      { kind: 'set-mismatch', left: ['o'], right: ['subject', 'o'] },
      {
        kind: 'endpoint-as-diff-target',
        side: 'left',
        endpoint: 'https://example.org/sparql',
      },
      { kind: 'inline-upstream-kind', side: 'right', targetKind: 'view' },
      { kind: 'anonymous-view-execution', side: 'left', message: 'm' },
      { kind: 'anonymous-select-execution', side: 'right', message: 'm' },
      {
        kind: 'source',
        side: 'left',
        source: { kind: 'glob-load', glob: ['x'], message: 'm' },
      },
      { kind: 'legacy-message', message: 'm' },
    ];
    for (const v of variants) {
      expect(formatDiffError(v).length).toBeGreaterThan(0);
    }
  });
});
