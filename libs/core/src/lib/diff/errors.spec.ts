import { describe, expect, it } from 'vitest';
import { formatDiffError } from './errors';

describe('formatDiffError', () => {
  it('formats tabular-blank-node naming the offending column and explaining why', () => {
    const message = formatDiffError({
      kind: 'tabular-blank-node',
      column: 'x',
    });
    expect(message).toMatch(/\?x/);
    expect(message).toMatch(/blank node/i);
    expect(message).toMatch(/cross-side|identity/i);
  });

  it('formats legacy-message by passing the wrapped message through verbatim', () => {
    const message = formatDiffError({
      kind: 'legacy-message',
      message: 'unknown @id "foo" on left side',
    });
    expect(message).toBe('unknown @id "foo" on left side');
  });
});
