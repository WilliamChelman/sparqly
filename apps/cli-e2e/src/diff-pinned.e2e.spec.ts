import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import dedent from 'dedent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffBodyLines } from './helpers/hash';

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

const V1_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\n';
const V2_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\n';

// ADR-0029, issue #276 — diff slice. The single-target invariant (ADR-0005) is
// unchanged: each side of a diff is still one target, --left-ref / --right-ref
// just pin each one independently.
describe('sparqly diff --left-ref / --right-ref — per-side pinned globs (ADR-0029, issue #276)', () => {
  let repo: string;
  let configPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-diff-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, V1_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v1']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, V2_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v2']);
    await git(repo, ['tag', '-a', 'v1.3.0', '-m', 'release v1.3.0']);

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

  it('--left-ref v1.2.0 --right-ref v1.3.0 diffs the git-tree content of the two tags', async () => {
    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--skip-auto-source-annotation',
        '--config',
        configPath,
        '--left',
        '@docs',
        '--right',
        '@docs',
        '--left-ref',
        'v1.2.0',
        '--right-ref',
        'v1.3.0',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toEqual([
      '- ex:keep ex:p ex:old .',
      '+ ex:keep ex:p ex:new .',
    ]);
  });

  it('JSON diff source records carry per-side `gitRef` + `gitSha` for both --left-ref and --right-ref', async () => {
    const v1Sha = await git(repo, ['rev-parse', 'v1.2.0^{commit}']);
    const v2Sha = await git(repo, ['rev-parse', 'v1.3.0^{commit}']);

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--format=json',
        '--config',
        configPath,
        '--left',
        '@docs',
        '--right',
        '@docs',
        '--left-ref',
        'v1.2.0',
        '--right-ref',
        'v1.3.0',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.removed).toHaveLength(1);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.removed[0].sourceRecords).toEqual([
      expect.objectContaining({ gitRef: 'v1.2.0', gitSha: v1Sha }),
    ]);
    expect(parsed.added[0].sourceRecords).toEqual([
      expect.objectContaining({ gitRef: 'v1.3.0', gitSha: v2Sha }),
    ]);
  });

  it('same resolved SHA on both sides → empty diff, exit 0 (not an error)', async () => {
    const sha = await git(repo, ['rev-parse', 'v1.2.0^{commit}']);
    // Both sides pin to v1.2.0 — different ref strings could resolve to the
    // same SHA via tag/branch/sha; here we use the same tag + the full SHA
    // form to prove ref-string≠SHA-string still empties when the resolved
    // SHA matches.
    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--skip-auto-source-annotation',
        '--config',
        configPath,
        '--left',
        '@docs',
        '--right',
        '@docs',
        '--left-ref',
        'v1.2.0',
        '--right-ref',
        sha,
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    expect(diffBodyLines(result.stdout)).toEqual([]);
  });

  it('HTML diff renders the ref + resolved short SHA pair next to per-quad source attribution', async () => {
    const v1Sha = await git(repo, ['rev-parse', 'v1.2.0^{commit}']);
    const v2Sha = await git(repo, ['rev-parse', 'v1.3.0^{commit}']);
    const v1Short = v1Sha.slice(0, 7);
    const v2Short = v2Sha.slice(0, 7);

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '-f',
        'html',
        '--config',
        configPath,
        '--left',
        '@docs',
        '--right',
        '@docs',
        '--left-ref',
        'v1.2.0',
        '--right-ref',
        'v1.3.0',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(1);
    expect(result.stdout.startsWith('<!doctype html>')).toBe(true);
    expect(result.stdout).toContain(`v1.2.0 (resolved to ${v1Short})`);
    expect(result.stdout).toContain(`v1.3.0 (resolved to ${v2Short})`);
  });

  it('positional `@docs:v1.2.0 @docs:v1.3.0` produces byte-identical stdout to the flag form', async () => {
    const baseArgs = [
      'diff',
      '--quiet',
      '--skip-auto-source-annotation',
      '--config',
      configPath,
    ];
    const positional = await runCli(
      [...baseArgs, '@docs:v1.2.0', '@docs:v1.3.0'],
      { cwd: repo },
    );
    const flag = await runCli(
      [
        ...baseArgs,
        '--left',
        '@docs',
        '--right',
        '@docs',
        '--left-ref',
        'v1.2.0',
        '--right-ref',
        'v1.3.0',
      ],
      { cwd: repo },
    );
    expect(positional.exitCode, `stderr=${positional.stderr}`).toBe(1);
    expect(flag.exitCode, `stderr=${flag.stderr}`).toBe(1);
    expect(positional.stdout).toBe(flag.stdout);
  });
});
