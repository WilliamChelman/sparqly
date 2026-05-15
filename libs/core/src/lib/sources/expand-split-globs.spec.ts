import { describe, expect, it, vi } from 'vitest';
import { expandSplitGlobs } from './expand-split-globs';
import type { ParsedGlobSource } from './source-spec';
import type { ParsedTransform } from './transform-spec';

function captureLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('expandSplitGlobs — shape', () => {
  it('emits the meta plus one kind:file child per matched file with derived ids', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: 'data/**/*.ttl',
      splitByFile: true,
    };
    const walker = async (pattern: string) => {
      expect(pattern).toBe('data/**/*.ttl');
      return [
        '/abs/proj/data/alice.ttl',
        '/abs/proj/data/people/bob.ttl',
      ];
    };

    const expanded = await expandSplitGlobs([meta], { walkGlob: walker });

    expect(expanded).toEqual([
      meta,
      {
        kind: 'file',
        id: 'docs/alice.ttl',
        path: '/abs/proj/data/alice.ttl',
        parentId: 'docs',
      },
      {
        kind: 'file',
        id: 'docs/people/bob.ttl',
        path: '/abs/proj/data/people/bob.ttl',
        parentId: 'docs',
      },
    ]);
  });
});

describe('expandSplitGlobs — transforms', () => {
  it("deep-copies the meta's transforms onto each child so mutating a child's transforms does not affect siblings or the meta", async () => {
    const transform: ParsedTransform = {
      key: 'graphName',
      apply: (s) => s,
    };
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: 'data/*.ttl',
      splitByFile: true,
      transforms: [transform],
    };
    const walker = async () => [
      '/abs/proj/data/a.ttl',
      '/abs/proj/data/b.ttl',
    ];

    const expanded = await expandSplitGlobs([meta], { walkGlob: walker });
    const children = expanded.filter((s) => s.kind === 'file');
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.kind).toBe('file');
      const tx = (child as { transforms?: ParsedTransform[] }).transforms;
      expect(tx).toBeDefined();
      expect(tx).toHaveLength(1);
      // Distinct object identity per child (deep copy, not shared reference).
      expect(tx?.[0]).not.toBe(transform);
      // Preserves the parsed shape.
      expect(tx?.[0]?.key).toBe('graphName');
    }
    // Sibling children carry independent transform objects.
    const a = (children[0] as { transforms?: ParsedTransform[] }).transforms;
    const b = (children[1] as { transforms?: ParsedTransform[] }).transforms;
    expect(a?.[0]).not.toBe(b?.[0]);
  });

  it('default-marker stays on the meta only and is never propagated to children', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: 'data/*.ttl',
      splitByFile: true,
      default: true,
    };
    const walker = async () => [
      '/abs/proj/data/a.ttl',
      '/abs/proj/data/b.ttl',
    ];
    const expanded = await expandSplitGlobs([meta], { walkGlob: walker });
    // Meta keeps its default marker.
    const out = expanded.find((s) => s.kind === 'glob');
    expect((out as { default?: true }).default).toBe(true);
    const children = expanded.filter((s) => s.kind === 'file');
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect((child as { default?: unknown }).default).toBeUndefined();
    }
  });

  it('omits transforms on each child when the meta declares none', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: 'data/*.ttl',
      splitByFile: true,
    };
    const walker = async () => ['/abs/proj/data/a.ttl'];
    const expanded = await expandSplitGlobs([meta], { walkGlob: walker });
    const child = expanded.find((s) => s.kind === 'file');
    expect(child).toBeDefined();
    expect((child as { transforms?: ParsedTransform[] }).transforms).toBeUndefined();
  });
});

describe('expandSplitGlobs — pass-through', () => {
  it('passes non-split entries through unchanged and does not call the walker for them', async () => {
    const plainGlob: ParsedGlobSource = {
      kind: 'glob',
      id: 'plain',
      glob: 'other/*.ttl',
    };
    const endpoint = {
      kind: 'endpoint',
      id: 'live',
      endpoint: 'https://example.com/sparql',
    } as const;
    const empty = { kind: 'empty', id: 'blank' } as const;
    const reference = { kind: 'reference', ref: 'plain' } as const;

    const walker = vi.fn(async () => []);

    const expanded = await expandSplitGlobs(
      [plainGlob, endpoint, empty, reference],
      { walkGlob: walker },
    );

    expect(expanded).toEqual([plainGlob, endpoint, empty, reference]);
    expect(walker).not.toHaveBeenCalled();
  });
});

describe('expandSplitGlobs — gitRef dispatch (ADR-0029, issue #274)', () => {
  it('routes pinned split-glob metas through walkGitGlob, not walkGlob; children inherit the pin', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      splitByFile: true,
      gitRef: 'v1.2.0',
    };
    const sha = 'a'.repeat(40);
    const walkGitGlob = vi.fn(async () => ({
      files: ['/abs/repo/data/foo.ttl', '/abs/repo/data/bar.ttl'],
      repoRoot: '/abs/repo',
      ref: 'v1.2.0',
      resolvedSha: sha,
    }));
    const walkGlob = vi.fn(async () => []);

    const expanded = await expandSplitGlobs([meta], { walkGlob, walkGitGlob });

    expect(walkGlob).not.toHaveBeenCalled();
    expect(walkGitGlob).toHaveBeenCalledOnce();
    expect(walkGitGlob).toHaveBeenCalledWith(meta);
    expect(expanded).toEqual([
      meta,
      {
        kind: 'file',
        id: 'docs/foo.ttl',
        path: '/abs/repo/data/foo.ttl',
        parentId: 'docs',
        gitRef: 'v1.2.0',
        repoRoot: '/abs/repo',
        resolvedSha: sha,
      },
      {
        kind: 'file',
        id: 'docs/bar.ttl',
        path: '/abs/repo/data/bar.ttl',
        parentId: 'docs',
        gitRef: 'v1.2.0',
        repoRoot: '/abs/repo',
        resolvedSha: sha,
      },
    ]);
  });

  it("propagates the meta's transform pipeline onto pinned children (deep-copied)", async () => {
    const transform: ParsedTransform = { key: 'graphName', apply: (s) => s };
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      splitByFile: true,
      gitRef: 'v1.2.0',
      transforms: [transform],
    };
    const walkGitGlob = async () => ({
      files: ['/abs/repo/data/foo.ttl'],
      repoRoot: '/abs/repo',
      ref: 'v1.2.0',
      resolvedSha: 'a'.repeat(40),
    });

    const expanded = await expandSplitGlobs([meta], {
      walkGlob: async () => [],
      walkGitGlob,
    });

    const child = expanded.find((s) => s.kind === 'file') as
      | (ParsedGlobSource & { transforms?: ParsedTransform[] })
      | undefined;
    expect(child).toBeDefined();
    const tx = (child as { transforms?: ParsedTransform[] }).transforms;
    expect(tx).toHaveLength(1);
    expect(tx?.[0]).not.toBe(transform);
    expect(tx?.[0]?.key).toBe('graphName');
  });

  it('keeps child id as `<parentId>/<path>` regardless of ref — golden child shape', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      splitByFile: true,
      gitRef: 'v1.2.0',
    };
    const walkGitGlob = async () => ({
      files: ['/abs/repo/data/foo.ttl'],
      repoRoot: '/abs/repo',
      ref: 'v1.2.0',
      resolvedSha: 'a'.repeat(40),
    });

    const expanded = await expandSplitGlobs([meta], {
      walkGlob: async () => [],
      walkGitGlob,
    });
    const child = expanded.find((s) => s.kind === 'file');
    expect(child).toMatchInlineSnapshot(`
      {
        "gitRef": "v1.2.0",
        "id": "docs/foo.ttl",
        "kind": "file",
        "parentId": "docs",
        "path": "/abs/repo/data/foo.ttl",
        "repoRoot": "/abs/repo",
        "resolvedSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }
    `);
  });

  it('lets walkGitGlob errors propagate verbatim at expand time', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      splitByFile: true,
      gitRef: 'v1.2.0',
    };
    const failure = new Error(
      'pinned glob matches span multiple git repositories: /abs/repo and /abs/repo/nested',
    );
    const walkGitGlob = async () => {
      throw failure;
    };
    await expect(
      expandSplitGlobs([meta], { walkGlob: async () => [], walkGitGlob }),
    ).rejects.toBe(failure);
  });

  it('throws when meta carries gitRef but no walkGitGlob dep is wired', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: '/abs/repo/data/*.ttl',
      splitByFile: true,
      gitRef: 'v1.2.0',
    };
    await expect(
      expandSplitGlobs([meta], { walkGlob: async () => [] }),
    ).rejects.toThrow(/walkGitGlob/);
  });
});

describe('expandSplitGlobs — zero-match', () => {
  it('emits one warn line through the injected logger and yields meta with no children', async () => {
    const meta: ParsedGlobSource = {
      kind: 'glob',
      id: 'docs',
      glob: 'data/*.ttl',
      splitByFile: true,
    };
    const logger = captureLogger();
    const walker = async () => [];

    const expanded = await expandSplitGlobs([meta], {
      walkGlob: walker,
      logger,
    });

    expect(expanded).toEqual([meta]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.warn.mock.calls[0];
    expect(msg).toContain('data/*.ttl');
    expect(msg).toContain('docs');
    expect(fields).toMatchObject({ glob: 'data/*.ttl', parentId: 'docs' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
