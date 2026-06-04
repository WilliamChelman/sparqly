import { describe, expect, it } from 'vitest';
import { describeTitleValue } from './describe-title-value';

const CTX = {
  prefixes: { foaf: 'http://xmlns.com/foaf/0.1/' },
  base: 'http://example.org/',
};

describe('describeTitleValue', () => {
  it('renders the submitted seed as a curie against the display context', () => {
    expect(
      describeTitleValue('http://xmlns.com/foaf/0.1/Person', CTX),
    ).toBe('foaf:Person');
  });

  it('is empty when nothing has been submitted yet', () => {
    expect(describeTitleValue('', CTX)).toBe('');
    expect(describeTitleValue('   ', CTX)).toBe('');
  });
});
