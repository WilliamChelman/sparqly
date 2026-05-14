import { describe, expect, it } from 'vitest';
import { deriveFileSourceId } from './derive-file-source-id';

describe('deriveFileSourceId — `**` patterns', () => {
  it('derives the file path relative to the static prefix for a `data/**/*.ttl` match', () => {
    expect(
      deriveFileSourceId('docs', 'data/**/*.ttl', '/abs/proj/data/people/alice.ttl'),
    ).toBe('docs/people/alice.ttl');
  });

  it('handles a deeply nested match under `**`', () => {
    expect(
      deriveFileSourceId(
        'docs',
        'data/**/*.ttl',
        '/abs/proj/data/a/b/c/d.ttl',
      ),
    ).toBe('docs/a/b/c/d.ttl');
  });
});

describe('deriveFileSourceId — single-segment patterns', () => {
  it('returns `<parentId>/<basename>` for a `*.ttl` match at the project root', () => {
    expect(
      deriveFileSourceId('docs', '*.ttl', '/abs/proj/foo.ttl'),
    ).toBe('docs/foo.ttl');
  });

  it('returns `<parentId>/<basename>` for a wildcard pattern inside a directory', () => {
    expect(
      deriveFileSourceId('docs', 'data/*.ttl', '/abs/proj/data/foo.ttl'),
    ).toBe('docs/foo.ttl');
  });
});

describe('deriveFileSourceId — paths with dots and dashes', () => {
  it('preserves dots in file names', () => {
    expect(
      deriveFileSourceId(
        'docs',
        'data/**/*.ttl',
        '/abs/proj/data/people/al.ice.ttl',
      ),
    ).toBe('docs/people/al.ice.ttl');
  });

  it('preserves dashes in directory and file names', () => {
    expect(
      deriveFileSourceId(
        'docs',
        'data/**/*.ttl',
        '/abs/proj/data/a-b/c-d/my-file.ttl',
      ),
    ).toBe('docs/a-b/c-d/my-file.ttl');
  });
});

describe('deriveFileSourceId — stability', () => {
  it('returns the same id for the same inputs regardless of call order', () => {
    const a = deriveFileSourceId(
      'docs',
      'data/**/*.ttl',
      '/abs/proj/data/x.ttl',
    );
    const b = deriveFileSourceId(
      'docs',
      'data/**/*.ttl',
      '/abs/proj/data/x.ttl',
    );
    expect(a).toBe(b);
  });

  it('does not depend on sibling-file ordering — siblings of the same parent get independent ids', () => {
    const first = deriveFileSourceId(
      'docs',
      'data/**/*.ttl',
      '/abs/proj/data/alice.ttl',
    );
    const second = deriveFileSourceId(
      'docs',
      'data/**/*.ttl',
      '/abs/proj/data/bob.ttl',
    );
    expect(first).toBe('docs/alice.ttl');
    expect(second).toBe('docs/bob.ttl');
  });
});

describe('deriveFileSourceId — absolute glob patterns', () => {
  it('derives a child id for an absolute glob (e.g. one produced by path.resolve)', () => {
    expect(
      deriveFileSourceId(
        'docs',
        '/abs/proj/data/**/*.ttl',
        '/abs/proj/data/people/alice.ttl',
      ),
    ).toBe('docs/people/alice.ttl');
  });
});
