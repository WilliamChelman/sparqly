import { describe, expect, it } from 'vitest';
import { describeErrorMessage } from './describe-error-message';

describe('describeErrorMessage', () => {
  it('returns the server-supplied message from a typed describe error body', () => {
    const body = {
      kind: 'endpoint-describe',
      endpoint: 'http://ex/sparql',
      message: 'endpoint http://ex/sparql: down',
    };
    expect(describeErrorMessage(body)).toBe('endpoint http://ex/sparql: down');
  });

  it('reads the message regardless of the error kind', () => {
    expect(
      describeErrorMessage({
        kind: 'no-default-multi',
        availableIds: ['alpha', 'beta'],
        message: 'name a source. Available: @alpha, @beta',
      }),
    ).toContain('@alpha');
  });

  it('falls back to a generic, non-empty message when the body has no usable message', () => {
    for (const body of [null, undefined, { kind: 'empty-target' }, { message: '' }, 'boom', 42]) {
      expect(describeErrorMessage(body).length).toBeGreaterThan(0);
    }
  });
});
