import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffBodyLines, hashLineRe, nonEmptyLines } from './helpers/hash';

const CLEARED_ENV = {} as const;

const FOO_TTL = '@prefix ex: <http://example.org/> .\nex:foo ex:p ex:a .\n';
const BAR_TTL = '@prefix ex: <http://example.org/> .\nex:bar ex:p ex:b .\n';

describe('sparqly split-glob — query/hash/diff against synthesized children', () => {
  let scratch: string;
  let configPath: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-split-glob-'));
    await writeFile(join(scratch, 'foo.ttl'), FOO_TTL);
    await writeFile(join(scratch, 'bar.ttl'), BAR_TTL);
    configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: docs
            glob: "${join(scratch, '*.ttl')}"
            splitByFile: true
      ` + '\n',
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('sparqly query @docs/foo.ttl returns only foo.ttl triples', async () => {
    const result = await runCli(
      [
        'query',
        '@docs/foo.ttl',
        '--config',
        configPath,
        '--quiet',
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    const subjects = json.results.bindings.map(
      (b: { s: { value: string } }) => b.s.value,
    );
    expect(subjects).toEqual(['http://example.org/foo']);
  });

  it('sparqly hash @docs/foo.ttl produces a stable hash line for the child', async () => {
    const first = await runCli(
      ['hash', '@docs/foo.ttl', '--config', configPath, '--quiet'],
      { env: CLEARED_ENV },
    );
    const second = await runCli(
      ['hash', '@docs/foo.ttl', '--config', configPath, '--quiet'],
      { env: CLEARED_ENV },
    );

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const lines = nonEmptyLines(first.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe('@docs/foo.ttl'));
    expect(first.stdout).toBe(second.stdout);
  });

  it('sparqly diff @docs/foo.ttl @docs/bar.ttl exits 1 and shows the two-file delta', async () => {
    const result = await runCli(
      [
        'diff',
        '@docs/foo.ttl',
        '@docs/bar.ttl',
        '--config',
        configPath,
        '--quiet',
        '--skip-auto-source-annotation',
      ],
      { env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    // Two-file diff: foo's triple removed, bar's triple added.
    expect(lines).toContain('- ex:foo ex:p ex:a .');
    expect(lines).toContain('+ ex:bar ex:p ex:b .');
  });

  it('sparqly hash @docs (the meta) hashes the union and stays stable across runs', async () => {
    const first = await runCli(
      ['hash', '@docs', '--config', configPath, '--quiet'],
      { env: CLEARED_ENV },
    );
    const second = await runCli(
      ['hash', '@docs', '--config', configPath, '--quiet'],
      { env: CLEARED_ENV },
    );

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    const lines = nonEmptyLines(first.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(hashLineRe('@docs'));
  });
});
