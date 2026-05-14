import { describe, expect, it } from 'vitest';
import { formatTargetError, type TargetError } from './errors';

describe('formatTargetError', () => {
  it('produces a non-empty message for every TargetError variant', () => {
    const variants: ReadonlyArray<TargetError> = [
      { kind: 'ref-as-target' },
      { kind: 'empty-registry' },
      { kind: 'no-default-multi', availableIds: ['files', 'live'] },
      { kind: 'no-default-multi', availableIds: [] },
      { kind: 'unknown-ref', ref: '@nope', availableIds: ['files'] },
      { kind: 'unknown-ref', ref: '@nope', availableIds: [] },
    ];
    for (const v of variants) {
      expect(formatTargetError(v).length).toBeGreaterThan(0);
    }
  });
});
