import { describe, expect, it } from 'vitest';
import { parseSourceAddress } from './address';

describe('parseSourceAddress (ADR-0029, issue #275)', () => {
  it('parses a bare id `@docs` to {id, ref: undefined}', () => {
    const result = parseSourceAddress('@docs');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: 'docs' });
  });

  it('parses `@docs:v1.2.0` to {id: "docs", ref: "v1.2.0"}', () => {
    const result = parseSourceAddress('@docs:v1.2.0');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: 'docs', ref: 'v1.2.0' });
  });

  it('parses `@docs/people/alice.ttl:v1.2` — split-glob child id with `/` segments', () => {
    const result = parseSourceAddress('@docs/people/alice.ttl:v1.2');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      id: 'docs/people/alice.ttl',
      ref: 'v1.2',
    });
  });

  it('splits on the *last* `:` — `@a:b:c` -> id=`a:b`, ref=`c`', () => {
    const result = parseSourceAddress('@a:b:c');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: 'a:b', ref: 'c' });
  });

  it('keeps `/` in the ref as part of the ref (e.g. `feature/foo`)', () => {
    const result = parseSourceAddress('@docs:feature/foo');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: 'docs', ref: 'feature/foo' });
  });

  it('keeps tag-legal chars (`HEAD~3`, `v1.2.0`, `.`) intact in the ref', () => {
    expect(parseSourceAddress('@docs:HEAD~3')._unsafeUnwrap()).toEqual({
      id: 'docs',
      ref: 'HEAD~3',
    });
  });

  it('errors on missing leading `@`', () => {
    const result = parseSourceAddress('docs:v1.2');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().reason).toBe('missing-at-prefix');
  });

  it('errors on empty id (`@`, `@:`, `@:v1.2`)', () => {
    expect(parseSourceAddress('@')._unsafeUnwrapErr().reason).toBe('empty-id');
    expect(parseSourceAddress('@:')._unsafeUnwrapErr().reason).toBe('empty-id');
    expect(parseSourceAddress('@:v1.2')._unsafeUnwrapErr().reason).toBe(
      'empty-id',
    );
  });

  it('errors on empty ref after `:` (`@docs:`)', () => {
    expect(parseSourceAddress('@docs:')._unsafeUnwrapErr().reason).toBe(
      'empty-ref',
    );
  });
});
