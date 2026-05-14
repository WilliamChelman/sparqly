import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffFixture, hashFixture } from './helpers/hash';

describe('sparqly hash — logging', () => {
  it('--quiet produces only the hash on stdout, with empty stderr', async () => {
    const result = await runCli(['hash', '--quiet', hashFixture('domain.ttl')]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/^[0-9a-f]{64} {2}/);
  });
});

describe('sparqly diff — logging', () => {
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
