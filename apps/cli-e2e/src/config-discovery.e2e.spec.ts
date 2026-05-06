import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

const NOOP_QUERY = 'SELECT * WHERE { ?s ?p ?o } LIMIT 0';

describe('sparqly config — auto-discovery (walk-up from CWD)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-discovery-')),
    );
    // Mark the directory as a git root so the walk-up has a stop boundary
    // and never picks up an outer config from somewhere on the host.
    await mkdir(join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('loads ancestor sparqly.config.yaml when invoked from a subdirectory', async () => {
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(configPath, dedent`
      cache:
        dir: .sparqly-cache
    ` + '\n');

    const sub = join(projectRoot, 'pkg', 'src');
    await mkdir(sub, { recursive: true });

    const result = await runCli(
      ['query', queryFixture('people.ttl'), '-q', NOOP_QUERY, '--verbose'],
      { cwd: sub, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`Loaded config from ${configPath}`);
  });

  it('--no-config skips auto-discovery even when a project config is present', async () => {
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(configPath, dedent`
      cache:
        dir: .sparqly-cache
    ` + '\n');

    const result = await runCli(
      [
        'query',
        queryFixture('people.ttl'),
        '-q',
        NOOP_QUERY,
        '--verbose',
        '--no-config',
      ],
      { cwd: projectRoot, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Loaded config from');
  });

  it('SPARQLY_CONFIG="" skips auto-discovery (mirrors --no-config)', async () => {
    const configPath = join(projectRoot, 'sparqly.config.yaml');
    await writeFile(configPath, dedent`
      cache:
        dir: .sparqly-cache
    ` + '\n');

    const result = await runCli(
      ['query', queryFixture('people.ttl'), '-q', NOOP_QUERY, '--verbose'],
      { cwd: projectRoot, env: { ...CLEARED_ENV, SPARQLY_CONFIG: '' } },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('Loaded config from');
  });

  it('errors clearly when two sparqly config extensions coexist in the same dir', async () => {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      'cache:\n  dir: .a\n',
    );
    await writeFile(
      join(projectRoot, 'sparqly.config.json'),
      '{"cache":{"dir":".b"}}',
    );

    const result = await runCli(
      ['query', queryFixture('people.ttl'), '-q', NOOP_QUERY],
      { cwd: projectRoot, env: CLEARED_ENV },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/multiple sparqly config files/);
    expect(result.stderr).toContain('sparqly.config.yaml');
    expect(result.stderr).toContain('sparqly.config.json');
    expect(result.stderr).toContain(projectRoot);
  });
});
