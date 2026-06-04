import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
  it('joins a value, the page name, and the brand with em-dashes', () => {
    expect(pageTitle('foaf:Person', 'Describe')).toBe(
      'foaf:Person — Describe — sparqly',
    );
  });

  it('drops the value segment when it is empty or null', () => {
    expect(pageTitle('', 'Sources')).toBe('Sources — sparqly');
    expect(pageTitle(null, 'Sources')).toBe('Sources — sparqly');
    expect(pageTitle('   ', 'Sources')).toBe('Sources — sparqly');
  });
});
