import dedent from 'dedent';
import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { formatFixture } from './helpers/hash';

describe('sparqly format — core happy path', () => {
  it('formats a glob and prints to stdout, exit 0', async () => {
    const result = await runCli(['format', formatFixture('simple.ttl')]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).not.toContain('@prefix unused:');
    expect(result.stdout).toContain('ex:a a ex:Thing');
  });

  it('reads turtle from stdin when no positional argument is supplied', async () => {
    const turtle = dedent`
      @prefix ex: <http://example.org/> .
      ex:b ex:p ex:c .
      ex:a ex:p ex:b .
    ` + '\n';

    const result = await runCli(['format'], { stdin: turtle });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatchInlineSnapshot(`
      "@prefix ex: <http://example.org/>.

      ex:a ex:p ex:b.

      ex:b ex:p ex:c.
      "
    `);
  });

  it('errors when no glob is supplied and stdin is a TTY', async () => {
    const result = await runCli(['format']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/glob|stdin|input/i);
  });
});
