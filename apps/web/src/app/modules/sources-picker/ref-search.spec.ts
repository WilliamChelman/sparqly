import { searchRefs } from './ref-search';
import type { RefsResponse } from './refs-api.client';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const SAMPLE: RefsResponse = {
  head: { ref: 'HEAD', sha: SHA_A, kind: 'head' },
  branches: [
    { ref: 'main', sha: SHA_A, kind: 'branch' },
    { ref: 'feat/auth-rewrite', sha: SHA_B, kind: 'branch' },
  ],
  remoteBranches: [
    { ref: 'origin/main', sha: SHA_A, kind: 'remote-branch', remote: 'origin' },
    { ref: 'upstream/main', sha: SHA_C, kind: 'remote-branch', remote: 'upstream' },
  ],
  tags: [
    { ref: 'v1.0.0', sha: SHA_B, kind: 'tag-annotated' },
    { ref: 'light-1.0', sha: SHA_C, kind: 'tag-lightweight' },
  ],
};

describe('searchRefs', () => {
  it('passes every input section through when the query is empty', () => {
    const result = searchRefs(SAMPLE, '');

    expect(result.head?.ref).toBe('HEAD');
    expect(result.branches.map((b) => b.ref).sort()).toEqual(
      ['main', 'feat/auth-rewrite'].sort(),
    );
    expect(result.remoteBranches.map((r) => r.ref).sort()).toEqual(
      ['origin/main', 'upstream/main'].sort(),
    );
    expect(result.tags.map((t) => t.ref).sort()).toEqual(
      ['v1.0.0', 'light-1.0'].sort(),
    );
  });

  it('queries of ≥4 hex chars also match by SHA prefix (reverse-lookup)', () => {
    const refs: RefsResponse = {
      head: { ref: 'HEAD', sha: 'abc1234deadbeef00000000000000000000bbbbb', kind: 'head' },
      branches: [
        { ref: 'main', sha: 'abc1234deadbeef00000000000000000000bbbbb', kind: 'branch' },
        { ref: 'feat/other', sha: 'fffffff0000000000000000000000000000ccccc', kind: 'branch' },
      ],
      remoteBranches: [],
      tags: [
        { ref: 'v1.0.0', sha: 'abc1234deadbeef00000000000000000000bbbbb', kind: 'tag-annotated' },
      ],
    };

    const result = searchRefs(refs, 'abc1');

    expect(result.branches.map((b) => b.ref)).toEqual(['main']);
    expect(result.tags.map((t) => t.ref)).toEqual(['v1.0.0']);
    expect(result.head?.ref).toBe('HEAD');
  });

  it('hex queries shorter than 4 chars do NOT trigger SHA-prefix matching (name only)', () => {
    const refs: RefsResponse = {
      head: { ref: 'HEAD', sha: 'abc1234deadbeef00000000000000000000bbbbb', kind: 'head' },
      branches: [{ ref: 'main', sha: 'abc1234deadbeef00000000000000000000bbbbb', kind: 'branch' }],
      remoteBranches: [],
      tags: [],
    };

    const result = searchRefs(refs, 'abc');

    expect(result.head).toBeUndefined();
    expect(result.branches).toEqual([]);
  });

  it('sorts within-section by kind priority during search (reproducible kinds rank higher)', () => {
    const refs: RefsResponse = {
      branches: [],
      remoteBranches: [],
      tags: [
        // Mixed in declaration order: lightweight before annotated.
        { ref: 'release-1.0', sha: SHA_A, kind: 'tag-lightweight' },
        { ref: 'release-2.0', sha: SHA_B, kind: 'tag-annotated' },
        { ref: 'release-3.0', sha: SHA_C, kind: 'tag-lightweight' },
        { ref: 'release-4.0', sha: SHA_A, kind: 'tag-annotated' },
      ],
    };

    const result = searchRefs(refs, 'release');

    // Annotated tags (reproducible) come before lightweight tags during search.
    expect(result.tags.map((t) => t.ref)).toEqual([
      'release-2.0',
      'release-4.0',
      'release-1.0',
      'release-3.0',
    ]);
  });

  it('sorts within-section alphabetically when the query is empty', () => {
    const refs: RefsResponse = {
      branches: [
        { ref: 'main', sha: SHA_A, kind: 'branch' },
        { ref: 'feat/x', sha: SHA_B, kind: 'branch' },
      ],
      remoteBranches: [],
      tags: [
        { ref: 'v2.0.0', sha: SHA_C, kind: 'tag-annotated' },
        { ref: 'v1.0.0', sha: SHA_A, kind: 'tag-annotated' },
      ],
    };

    const result = searchRefs(refs, '');

    expect(result.branches.map((b) => b.ref)).toEqual(['feat/x', 'main']);
    expect(result.tags.map((t) => t.ref)).toEqual(['v1.0.0', 'v2.0.0']);
  });

  it('case-insensitive substring matches ref names and elides sections that have no matches', () => {
    const result = searchRefs(SAMPLE, 'AUTH');

    expect(result.head).toBeUndefined();
    expect(result.branches.map((b) => b.ref)).toEqual(['feat/auth-rewrite']);
    expect(result.remoteBranches).toEqual([]);
    expect(result.tags).toEqual([]);
  });
});
