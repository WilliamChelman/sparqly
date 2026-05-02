import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const MINIMAL_TTL = resolve(HERE, '../fixtures/minimal.ttl');

const CLEARED_ENV = {
  SPARQLY_GRAPH_MODE: undefined,
  SPARQLY_MUTABLE: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

describe('config — backward compatibility and --help surface', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-backcompat-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it.each(['query', 'serve'] as const)(
    '%s --help lists --config',
    async (command) => {
      const result = await runCli([command, '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--config');
    },
  );

  it('query runs a SELECT against a positional glob with no config file and no new flags', async () => {
    const result = await runCli(
      [
        'query',
        '--quiet',
        MINIMAL_TTL,
        '-q',
        'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      ],
      { cwd: scratch, env: CLEARED_ENV },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      head: { vars: string[] };
      results: { bindings: unknown[] };
    };
    expect(parsed.head.vars).toEqual(['s', 'p', 'o']);
    expect(parsed.results.bindings).toHaveLength(1);
  });

});
