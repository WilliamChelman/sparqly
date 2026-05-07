import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';

describe('sparqly query — input paths', () => {
  const sources = queryFixture('people.ttl');

  it('-q runs an inline SPARQL query against a positional glob (US 1, 2)', async () => {
    const result = await runCli(['query', sources, '-q', SELECT_ALL, '--quiet']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const json = JSON.parse(result.stdout);
    expect(json.head.vars).toEqual(expect.arrayContaining(['s', 'p', 'o']));
    expect(json.results.bindings).toHaveLength(5);
  });

  it('--query-file reads SPARQL from disk (US 3)', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'sparqly-q-file-'));
    try {
      const queryPath = join(scratch, 'q.rq');
      await writeFile(queryPath, SELECT_ALL);

      const result = await runCli([
        'query',
        sources,
        '--query-file',
        queryPath,
      ]);

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.results.bindings).toHaveLength(5);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('reads the query from stdin when no -q or --query-file is given (US 4)', async () => {
    const result = await runCli(['query', sources], { stdin: SELECT_ALL });

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.results.bindings).toHaveLength(5);
  });

  it('rejects more than one query source', async () => {
    const result = await runCli(['query', sources, '-q', SELECT_ALL], {
      stdin: SELECT_ALL,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/only one query source/);
  });

  it('rejects -q combined with --query-file', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'sparqly-q-file-'));
    try {
      const queryPath = join(scratch, 'q.rq');
      await writeFile(queryPath, SELECT_ALL);

      const result = await runCli([
        'query',
        sources,
        '-q',
        SELECT_ALL,
        '--query-file',
        queryPath,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/only one query source/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('rejects --query-file combined with piped stdin', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'sparqly-q-file-'));
    try {
      const queryPath = join(scratch, 'q.rq');
      await writeFile(queryPath, SELECT_ALL);

      const result = await runCli(
        ['query', sources, '--query-file', queryPath],
        { stdin: SELECT_ALL },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/only one query source/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
