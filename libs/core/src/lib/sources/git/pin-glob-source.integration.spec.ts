import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSourceResult } from '../resolve-source-result';
import type { ParsedGlobSource } from '../source-spec';

const execFileAsync = promisify(execFile);

async function git(
  repo: string,
  args: ReadonlyArray<string>,
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  return stdout.trim();
}

const OLD_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\n';
const NEW_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\n';

describe('resolveSourceResult — pinned glob (ADR-0029)', () => {
  let repo: string;
  let oldSha: string;
  let foafPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-pin-glob-'));
    foafPath = join(repo, 'foaf.ttl');
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(foafPath, OLD_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    oldSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    // Edit the working tree to a new value; the pinned source should still
    // see the OLD content, not the working-tree content.
    await writeFile(foafPath, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
    // Now leave the working tree at NEW_TTL but pin to v1.2.0.
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  function source(overrides: Partial<ParsedGlobSource> = {}): ParsedGlobSource {
    return {
      kind: 'glob',
      glob: foafPath,
      id: 'foaf',
      gitRef: 'v1.2.0',
      ...overrides,
    };
  }

  it('reads file content from the git tree at the resolved SHA, not the working tree', async () => {
    const result = await resolveSourceResult(source(), { configDir: repo });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const objects = [...result.value.store].map((q) => q.object.value);
    expect(objects).toEqual(['http://example.org/old']);
  });

  it('resolves a full SHA as gitRef', async () => {
    const result = await resolveSourceResult(source({ gitRef: oldSha }), {
      configDir: repo,
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const objects = [...result.value.store].map((q) => q.object.value);
    expect(objects).toEqual(['http://example.org/old']);
  });

  it('returns a git-pin error with reason "unresolvable-ref" for an unknown ref', async () => {
    const result = await resolveSourceResult(source({ gitRef: 'v999' }), {
      configDir: repo,
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    if (result.error.kind !== 'git-pin') throw new Error('unreachable');
    expect(result.error.reason).toBe('unresolvable-ref');
  });

  it('returns a git-pin error with reason "no-repo-found" when no repo is reachable', async () => {
    const lonely = await mkdtemp(join(tmpdir(), 'sparqly-pin-norepo-'));
    try {
      const lonelyFile = join(lonely, 'foaf.ttl');
      await writeFile(lonelyFile, OLD_TTL);
      const result = await resolveSourceResult(
        source({ glob: lonelyFile }),
        { configDir: lonely },
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) throw new Error('unreachable');
      expect(result.error.kind).toBe('git-pin');
      if (result.error.kind !== 'git-pin') throw new Error('unreachable');
      expect(result.error.reason).toBe('no-repo-found');
    } finally {
      await rm(lonely, { recursive: true, force: true });
    }
  });

  it('returns a git-pin error with reason "gitroot-not-a-repo" when gitRoot points at a non-repo path', async () => {
    const result = await resolveSourceResult(
      source({ gitRoot: './not-a-repo' }),
      { configDir: repo },
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('git-pin');
    if (result.error.kind !== 'git-pin') throw new Error('unreachable');
    expect(result.error.reason).toBe('gitroot-not-a-repo');
  });
});
