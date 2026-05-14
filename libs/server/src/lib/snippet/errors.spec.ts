import { describe, expect, it } from 'vitest';
import { formatSnippetError } from './errors';

describe('formatSnippetError', () => {
  it('formats file-read naming the file path and underlying reason', () => {
    const message = formatSnippetError({
      kind: 'file-read',
      file: '/abs/path/data.ttl',
      reason: 'missing',
    });
    expect(message).toMatch(/\/abs\/path\/data\.ttl/);
    expect(message).toMatch(/missing/);
  });

  it('formats range-malformed quoting the offending spec and the structural reason', () => {
    const message = formatSnippetError({
      kind: 'range-malformed',
      spec: 'banana',
      reason: 'shape',
    });
    expect(message).toMatch(/"banana"/);
    expect(message).toMatch(/shape/);
  });

  it('formats range-out-of-bounds quoting the offending spec', () => {
    const message = formatSnippetError({
      kind: 'range-out-of-bounds',
      spec: '999',
    });
    expect(message).toMatch(/"999"/);
    expect(message).toMatch(/past end/i);
  });

  it('formats target by delegating to formatTargetError (unknown-ref carries the offending ref and available list)', () => {
    const message = formatSnippetError({
      kind: 'target',
      target: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['alpha', 'beta'],
      },
    });
    expect(message).toMatch(/@nope/);
    expect(message).toMatch(/@alpha/);
    expect(message).toMatch(/@beta/);
  });
});
