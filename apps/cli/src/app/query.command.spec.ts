import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { QueryCommand } from './query.command';

describe('QueryCommand.run', () => {
  let dir: string;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-cli-'));
    stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  function joinCalls(spy: MockInstance<typeof process.stdout.write>): string {
    return spy.mock.calls
      .map((args) => {
        const chunk = (args as unknown[])[0] as string | Buffer | undefined;
        if (chunk == null) return '';
        return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      })
      .join('');
  }

  const stdoutText = (): string => joinCalls(stdout);
  const stderrText = (): string => joinCalls(stderr);

  it('runs a SELECT against a glob and emits JSON results to stdout', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero when the glob matches no files', async () => {
    const cmd = new QueryCommand();
    await cmd.run([join(dir, 'nope-*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/no files/i);
  });

  it('exits non-zero on a parse error and names the file in stderr', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/broken\.ttl/);
  });

  it('exits non-zero on a query error', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText().length).toBeGreaterThan(0);
  });
});
