import { describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const sources = queryFixture('people.ttl');

const INSERT_DATA =
  'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }';

describe('sparqly query — immutability guard', () => {
  it('rejects mutating queries by default with a clear error and non-zero exit (US 7)', async () => {
    const result = await runCli(['query', sources, '-q', INSERT_DATA]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Mutating queries are disabled/);
    expect(result.stderr).toMatch(/--mutable|--immutable=false/);
  });

  it('--mutable advances past the immutability guard (US 8)', async () => {
    const result = await runCli([
      'query',
      sources,
      '--mutable',
      '-q',
      INSERT_DATA,
    ]);

    expect(result.stderr).not.toMatch(/Mutating queries are disabled/);
    expect(result.stderr).toMatch(/Mutating execution is not yet implemented/);
  });

  it('--immutable=false advances past the immutability guard (US 8)', async () => {
    const result = await runCli([
      'query',
      sources,
      '--immutable=false',
      '-q',
      INSERT_DATA,
    ]);

    expect(result.stderr).not.toMatch(/Mutating queries are disabled/);
    expect(result.stderr).toMatch(/Mutating execution is not yet implemented/);
  });
});
