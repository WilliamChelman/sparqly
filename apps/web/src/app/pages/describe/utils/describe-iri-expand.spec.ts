import { describe, expect, it } from 'vitest';
import { describeIriExpand } from './describe-iri-expand';

const PREFIXES = {
  ex: 'http://example.org/',
  foaf: 'http://xmlns.com/foaf/0.1/',
};

describe('describeIriExpand', () => {
  it('passes a bare absolute IRI through unchanged', () => {
    expect(describeIriExpand('http://example.org/alice', PREFIXES)).toEqual({
      ok: true,
      iri: 'http://example.org/alice',
    });
  });

  it('strips angle brackets from a bracketed IRI', () => {
    expect(
      describeIriExpand('<http://example.org/alice>', PREFIXES),
    ).toEqual({ ok: true, iri: 'http://example.org/alice' });
  });

  it('expands a prefixed name against the prefix map', () => {
    expect(describeIriExpand('ex:alice', PREFIXES)).toEqual({
      ok: true,
      iri: 'http://example.org/alice',
    });
  });

  it('expands a prefixed name with an empty local part', () => {
    expect(describeIriExpand('foaf:', PREFIXES)).toEqual({
      ok: true,
      iri: 'http://xmlns.com/foaf/0.1/',
    });
  });

  it('returns an error for an unknown prefix instead of treating it as bare', () => {
    const result = describeIriExpand('nope:alice', PREFIXES);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error).toContain('nope');
  });

  it('returns an error for empty input', () => {
    const result = describeIriExpand('   ', PREFIXES);
    expect(result.ok).toBe(false);
  });

  it('returns an error for a relative IRI with no scheme or known prefix', () => {
    const result = describeIriExpand('alice', PREFIXES);
    expect(result.ok).toBe(false);
  });

  it('trims surrounding whitespace before expanding', () => {
    expect(describeIriExpand('  ex:alice  ', PREFIXES)).toEqual({
      ok: true,
      iri: 'http://example.org/alice',
    });
  });
});
