import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

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

const SELECT_OBJECTS =
  'SELECT ?o WHERE { ?s <http://example.org/p> ?o }';

describe('sparqly query --at — pinned glob (ADR-0029, issue #272)', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-query-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('--at v1.2.0 reads the file from the git tree at the tag, not the working tree', async () => {
    const result = await runCli(
      ['query', 'foaf.ttl', '-q', SELECT_OBJECTS, '--at', 'v1.2.0', '--quiet'],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    expect(objects).toEqual(['http://example.org/old']);
  });

  it('--at <unknown-ref> exits 39 with a git-pin "unresolvable-ref" message', async () => {
    const result = await runCli(
      ['query', 'foaf.ttl', '-q', SELECT_OBJECTS, '--at', 'v999'],
      { cwd: repo },
    );
    expect(result.exitCode).toBe(39);
    expect(result.stderr).toMatch(/gitRef "v999".*did not resolve/);
  });

  it('--at <ref> outside a repo exits 39 with a "no-repo-found" message', async () => {
    const lonely = await mkdtemp(join(tmpdir(), 'sparqly-query-pin-norepo-'));
    try {
      await writeFile(join(lonely, 'foaf.ttl'), OLD_TTL);
      const result = await runCli(
        ['query', 'foaf.ttl', '-q', SELECT_OBJECTS, '--at', 'v1.2.0'],
        { cwd: lonely },
      );
      expect(result.exitCode).toBe(39);
      expect(result.stderr).toMatch(/gitRef requires a git repository/);
    } finally {
      await rm(lonely, { recursive: true, force: true });
    }
  });
});
