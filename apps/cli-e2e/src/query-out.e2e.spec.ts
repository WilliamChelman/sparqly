import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const sources = queryFixture('people.ttl');
const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';

describe('sparqly query --out', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-out-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('writes byte-identical content to file as it would to stdout', async () => {
    const target = join(scratch, 'result.json');

    const stdoutResult = await runCli(['query', sources, '-q', SELECT_ALL]);
    expect(stdoutResult.exitCode).toBe(0);

    const fileResult = await runCli([
      'query',
      sources,
      '-q',
      SELECT_ALL,
      '--out',
      target,
    ]);
    expect(fileResult.exitCode).toBe(0);
    expect(fileResult.stdout).toBe('');

    const written = await readFile(target, 'utf8');
    expect(written).toBe(stdoutResult.stdout);
  });

  it('creates missing parent directories', async () => {
    const target = join(scratch, 'a', 'b', 'c', 'result.json');
    const result = await runCli([
      'query',
      sources,
      '-q',
      SELECT_ALL,
      '--out',
      target,
    ]);

    expect(result.exitCode).toBe(0);
    expect(await readFile(target, 'utf8')).toMatch(/"bindings"/);
  });

  it('silently overwrites an existing file', async () => {
    const target = join(scratch, 'result.json');
    await writeFile(target, 'stale\n');

    const result = await runCli([
      'query',
      sources,
      '-q',
      SELECT_ALL,
      '--out',
      target,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/exists/i);
    expect(await readFile(target, 'utf8')).toMatch(/"bindings"/);
  });

  it("rejects --out '-' with a clear error", async () => {
    const result = await runCli([
      'query',
      sources,
      '-q',
      SELECT_ALL,
      '--out',
      '-',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--out '-' is not supported/);
  });

  it('rejects --out targeting an existing directory', async () => {
    const dir = join(scratch, 'a-dir');
    await mkdir(dir);

    const result = await runCli([
      'query',
      sources,
      '-q',
      SELECT_ALL,
      '--out',
      dir,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      new RegExp(`--out path is a directory: .*${'a-dir'}`),
    );
  });

  it('honors `out:` from sparqly.config.yaml', async () => {
    const configPath = join(scratch, 'sparqly.config.yaml');
    const target = join(scratch, 'from-config.json');
    await writeFile(configPath, `out: ${JSON.stringify(target)}\n`);

    const result = await runCli(
      ['query', sources, '-q', SELECT_ALL, '--config', configPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readFile(target, 'utf8')).toMatch(/"bindings"/);
  });

});
