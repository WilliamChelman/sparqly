import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { leadingHash } from './helpers/hash';

const execFileAsync = promisify(execFile);

async function git(repo: string, args: ReadonlyArray<string>): Promise<string> {
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

describe('sparqly hash --at — pinned glob (ADR-0029, issue #272)', () => {
  let repo: string;
  let oldSha: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-hash-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    oldSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('--at v1.2.0 produces a deterministic hash that matches --at <full-SHA>', async () => {
    const [viaTag, viaSha] = await Promise.all([
      runCli(['hash', '--quiet', '--at', 'v1.2.0', 'foaf.ttl'], { cwd: repo }),
      runCli(['hash', '--quiet', '--at', oldSha, 'foaf.ttl'], { cwd: repo }),
    ]);
    expect(viaTag.exitCode, `stderr=${viaTag.stderr}`).toBe(0);
    expect(viaSha.exitCode, `stderr=${viaSha.stderr}`).toBe(0);
    expect(viaTag.stdout).toMatch(/^[0-9a-f]{64} {2}/);
    expect(leadingHash(viaTag.stdout)).toBe(leadingHash(viaSha.stdout));
  });

  it('--at v1.2.0 hashes the git-tree content, distinct from the working-tree hash', async () => {
    const [pinned, current] = await Promise.all([
      runCli(['hash', '--quiet', '--at', 'v1.2.0', 'foaf.ttl'], { cwd: repo }),
      runCli(['hash', '--quiet', 'foaf.ttl'], { cwd: repo }),
    ]);
    expect(pinned.exitCode).toBe(0);
    expect(current.exitCode).toBe(0);
    expect(leadingHash(pinned.stdout)).not.toBe(leadingHash(current.stdout));
  });

  it('--at <unknown-ref> exits 39 with a git-pin "unresolvable-ref" message', async () => {
    const result = await runCli(
      ['hash', '--at', 'v999', 'foaf.ttl'],
      { cwd: repo },
    );
    expect(result.exitCode).toBe(39);
    expect(result.stderr).toMatch(/gitRef "v999".*did not resolve/);
  });

  it('--at <ref> outside a repo exits 39 with a "no-repo-found" message', async () => {
    const lonely = await mkdtemp(join(tmpdir(), 'sparqly-hash-pin-norepo-'));
    try {
      await writeFile(join(lonely, 'foaf.ttl'), OLD_TTL);
      const result = await runCli(
        ['hash', '--at', 'v1.2.0', 'foaf.ttl'],
        { cwd: lonely },
      );
      expect(result.exitCode).toBe(39);
      expect(result.stderr).toMatch(/gitRef requires a git repository/);
    } finally {
      await rm(lonely, { recursive: true, force: true });
    }
  });
});
