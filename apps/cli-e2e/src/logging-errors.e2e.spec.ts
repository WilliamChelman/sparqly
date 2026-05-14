import { describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const SOURCES = queryFixture('people.ttl');
const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 1';

describe('sparqly query — logging', () => {
  it('--quiet produces only the result on stdout, with empty stderr (US 21)', async () => {
    const result = await runCli([
      'query',
      SOURCES,
      '--quiet',
      '-q',
      SELECT_ALL,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});

describe('sparqly query — error paths (US 22)', () => {
  it('a glob that matches nothing succeeds with empty results and a warn line (ADR-0028)', async () => {
    const result = await runCli([
      'query',
      '/tmp/sparqly-e2e-does-not-exist/*.ttl',
      '-q',
      SELECT_ALL,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/No files matched/);
  });

  it('a syntactically invalid query exits with the query-execution code and a clear error', async () => {
    const result = await runCli([
      'query',
      SOURCES,
      '-q',
      'this is not sparql',
    ]);

    expect(result.exitCode).toBe(33);
    expect(result.stderr).toMatch(/query execution failed/);
  });

  it('a missing --query-file path exits non-zero with a clear error', async () => {
    const result = await runCli([
      'query',
      SOURCES,
      '--query-file',
      '/tmp/sparqly-e2e-missing-query.rq',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--query-file/);
  });

  it('missing sources exits non-zero with a clear error', async () => {
    const result = await runCli(['query', '-q', SELECT_ALL]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/registry is empty|target source/);
  });

  it('missing query exits non-zero with a clear error', async () => {
    const result = await runCli(['query', SOURCES]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/query is required/);
  });
});
