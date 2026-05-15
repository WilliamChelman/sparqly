import { execFile } from 'node:child_process';
import dedent from 'dedent';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  // ADR-0029, issue #273 — floating refs (branches, HEAD, HEAD~n,
  // lightweight tags) emit a `<ref> → <sha>` info line on stderr at startup so
  // the user can see which commit a `main`-style pin actually used. The
  // matching source-record N-Quads shape (sparqly:gitRef / sparqly:gitSha) is
  // pinned by libs/core/.../pinned-source-record.golden.spec.ts.
  it('--at main (floating ref) logs `<ref> → <sha>` to stderr at startup', async () => {
    const headSha = await git(repo, ['rev-parse', 'HEAD']);
    const result = await runCli(
      ['query', 'foaf.ttl', '-q', SELECT_OBJECTS, '--at', 'main'],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    expect(result.stderr).toContain(`main → ${headSha}`);
    const json = JSON.parse(result.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    expect(objects).toEqual(['http://example.org/new']);
  });

  it('--at <full-sha> (pinned ref) does NOT log a `→` resolution line', async () => {
    const headSha = await git(repo, ['rev-parse', 'HEAD']);
    const result = await runCli(
      ['query', 'foaf.ttl', '-q', SELECT_OBJECTS, '--at', headSha],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    expect(result.stderr).not.toMatch(/→/);
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

// ADR-0029, issue #275 — `sparqly query @docs:v1.2.0` must desugar to
// `sparqly query @docs --at v1.2.0`, producing byte-identical output.
describe('sparqly query @id:ref — positional address parity (ADR-0029, issue #275)', () => {
  let repo: string;
  let configPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-query-positional-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);

    configPath = join(repo, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: docs
            glob: "foaf.ttl"
      ` + '\n',
    );
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('`@docs:v1.2.0` produces byte-identical stdout to `@docs --at v1.2.0`', async () => {
    const positional = await runCli(
      [
        'query',
        '@docs:v1.2.0',
        '--config',
        configPath,
        '-q',
        SELECT_OBJECTS,
        '--quiet',
      ],
      { cwd: repo },
    );
    const flag = await runCli(
      [
        'query',
        '@docs',
        '--config',
        configPath,
        '-q',
        SELECT_OBJECTS,
        '--at',
        'v1.2.0',
        '--quiet',
      ],
      { cwd: repo },
    );

    expect(positional.exitCode, `stderr=${positional.stderr}`).toBe(0);
    expect(flag.exitCode, `stderr=${flag.stderr}`).toBe(0);
    expect(positional.stdout).toBe(flag.stdout);

    const json = JSON.parse(positional.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    expect(objects).toEqual(['http://example.org/old']);
  });
});

// ADR-0029, issue #274 — split-glob enumeration walks the git tree at the
// resolved SHA. Files added after the ref must be absent (no `@docs/added.ttl`
// child); files deleted after the ref must be present (`@docs/keep.ttl` is the
// child id even though it no longer exists on disk).
describe('sparqly query — split-glob with gitRef (ADR-0029, issue #274)', () => {
  let repo: string;
  let configPath: string;
  const TTL_KEEP =
    '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:k1 .\n';
  const TTL_DELETED =
    '@prefix ex: <http://example.org/> .\nex:deletedLater ex:p ex:d1 .\n';
  const TTL_ADDED =
    '@prefix ex: <http://example.org/> .\nex:addedLater ex:p ex:a1 .\n';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-split-glob-pin-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs/keep.ttl'), TTL_KEEP);
    await writeFile(join(repo, 'docs/deleted-later.ttl'), TTL_DELETED);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v1']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release']);

    // After v1.2.0: add a new file, delete one, modify the kept file.
    await writeFile(
      join(repo, 'docs/keep.ttl'),
      '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:NEW .\n',
    );
    await writeFile(join(repo, 'docs/added-later.ttl'), TTL_ADDED);
    await rm(join(repo, 'docs/deleted-later.ttl'));
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-q', '-m', 'v2']);

    configPath = join(repo, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: docs
            glob: "docs/*.ttl"
            splitByFile: true
            gitRef: v1.2.0
      ` + '\n',
    );
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('querying @docs/keep.ttl returns the pre-v1.2.0 object (not the working-tree NEW value)', async () => {
    const result = await runCli(
      [
        'query',
        '@docs/keep.ttl',
        '--config',
        configPath,
        '-q',
        'SELECT ?o WHERE { ?s <http://example.org/p> ?o }',
        '--quiet',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    expect(objects).toEqual(['http://example.org/k1']);
  });

  it('querying @docs/deleted-later.ttl (deleted from working tree, present at v1.2.0) returns its triples', async () => {
    const result = await runCli(
      [
        'query',
        '@docs/deleted-later.ttl',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
        '--quiet',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    const subjects = json.results.bindings.map(
      (b: { s: { value: string } }) => b.s.value,
    );
    expect(subjects).toEqual(['http://example.org/deletedLater']);
  });

  it('querying @docs/added-later.ttl (added after v1.2.0) errors — that child id was never enumerated from the v1.2.0 tree', async () => {
    const result = await runCli(
      [
        'query',
        '@docs/added-later.ttl',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
        '--quiet',
      ],
      { cwd: repo },
    );
    expect(result.exitCode).not.toBe(0);
  });
});
