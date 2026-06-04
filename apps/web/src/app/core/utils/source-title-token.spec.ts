import { describe, expect, it } from 'vitest';
import { sourceTitleToken } from './source-title-token';

describe('sourceTitleToken', () => {
  it('renders a pinned address as id@ref', () => {
    expect(sourceTitleToken('@dbpedia:2024')).toBe('dbpedia@2024');
  });

  it('passes a plain id through unchanged', () => {
    expect(sourceTitleToken('dbpedia')).toBe('dbpedia');
  });

  it('returns empty for no source', () => {
    expect(sourceTitleToken('')).toBe('');
  });

  it('drops the @ when an address carries no ref', () => {
    expect(sourceTitleToken('@dbpedia')).toBe('dbpedia');
    expect(sourceTitleToken('@dbpedia:')).toBe('dbpedia:');
  });
});
