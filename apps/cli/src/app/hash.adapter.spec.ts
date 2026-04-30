import { describe, expect, it } from 'vitest';
import { isAdapterFailure } from './cli-errors';
import { hashAdapter } from './hash.adapter';

describe('hashAdapter', () => {
  it('passes through repeated --sources as a string array', () => {
    const result = hashAdapter([], {
      sources: ['a/*.ttl', 'b/*.ttl'],
      json: true,
    });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.sources).toEqual(['a/*.ttl', 'b/*.ttl']);
    expect(result.cliOverrides.json).toBe(true);
  });

  it('passes through --compare-with', () => {
    const result = hashAdapter([], { compareWith: 'other/*.ttl' });
    if (isAdapterFailure(result)) throw new Error('expected ok');
    expect(result.cliOverrides.compareWith).toBe('other/*.ttl');
  });

  it('rejects unknown --graph-strategy', () => {
    const result = hashAdapter([], { graphStrategy: 'bogus' });
    if (!isAdapterFailure(result)) throw new Error('expected error');
    expect(result.errors[0]).toEqual({
      kind: 'unknown-flag',
      message:
        "unknown --graph-strategy 'bogus' (expected default, partial, full, none)",
    });
  });
});
