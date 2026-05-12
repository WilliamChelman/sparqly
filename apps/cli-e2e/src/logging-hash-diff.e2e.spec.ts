import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffFixture, hashFixture } from './helpers/hash';

const CONSTRUCT_ALL = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

const SOURCE_LOADED_RE =
  /\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[sparqly\] source-loaded .*\bms=\d+/;
const VIEW_QUERY_RE =
  /\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[sparqly\] query .*\bmode=view\b.*\btype=CONSTRUCT\b.*\bms=\d+/;

describe('sparqly hash — logging', () => {
  it('--verbose surfaces a source-loaded DEBUG line on stderr', async () => {
    const result = await runCli(['hash', '--verbose', hashFixture('domain.ttl')]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(SOURCE_LOADED_RE);
  });

  it('--verbose --query emits the same `query` event format as `sparqly query`, with mode=view', async () => {
    const result = await runCli([
      'hash',
      '--verbose',
      '--query',
      CONSTRUCT_ALL,
      hashFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(VIEW_QUERY_RE);
  });

  it('--quiet produces only the hash on stdout, with empty stderr', async () => {
    const result = await runCli(['hash', '--quiet', hashFixture('domain.ttl')]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^[0-9a-f]{64} {2}/);
  });

  it('--log-format json emits the source-loaded line as JSON on stderr', async () => {
    const result = await runCli([
      'hash',
      '--verbose',
      '--log-format',
      'json',
      hashFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(0);
    const entry = result.stderr
      .split('\n')
      .filter((line) => line.trim().startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((e) => e.msg === 'source-loaded');
    expect(entry).toMatchObject({ level: 'debug', ctx: 'sparqly' });
    expect(typeof entry.ms).toBe('number');
  });
});

describe('sparqly diff — logging', () => {
  it('--verbose surfaces a source-loaded DEBUG line on stderr', async () => {
    const result = await runCli([
      'diff',
      '--verbose',
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(SOURCE_LOADED_RE);
  });

  it('--verbose --query emits the same `query` event format as `sparqly query`, with mode=view', async () => {
    const result = await runCli([
      'diff',
      '--verbose',
      '--query',
      CONSTRUCT_ALL,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(VIEW_QUERY_RE);
  });

  it('--quiet produces empty stderr', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });
});
