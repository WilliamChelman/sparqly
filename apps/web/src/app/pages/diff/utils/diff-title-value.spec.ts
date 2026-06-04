import { describe, expect, it } from 'vitest';
import { diffTitleValue } from './diff-title-value';

describe('diffTitleValue', () => {
  it('joins two distinct source tokens with an arrow', () => {
    expect(diffTitleValue('repo@v1', 'repo@v2')).toBe('repo@v1 → repo@v2');
  });

  it('collapses to a single token when both sides are identical', () => {
    expect(diffTitleValue('repo@v1', 'repo@v1')).toBe('repo@v1');
  });

  it('reduces to the present side when the other is empty', () => {
    expect(diffTitleValue('repo@v1', '')).toBe('repo@v1');
    expect(diffTitleValue('', 'repo@v2')).toBe('repo@v2');
  });

  it('returns empty when both sides are empty', () => {
    expect(diffTitleValue('', '')).toBe('');
  });
});
