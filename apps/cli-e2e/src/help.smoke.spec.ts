import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly --help', () => {
  it('exits 0 and prints the usage banner', async () => {
    const { stdout, stderr, exitCode } = await runCli(['--help']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: sparqly');
    expect(stderr).toBe('');
  });
});
