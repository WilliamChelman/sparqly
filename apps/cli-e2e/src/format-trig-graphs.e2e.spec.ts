import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { formatFixture } from './helpers/hash';

describe('sparqly format — TriG named graph sorting', () => {
  it('emits the default graph first, then named graphs in alphabetical order', async () => {
    const result = await runCli(['format', formatFixture('multi-graphs.trig'), '--quiet']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatchInlineSnapshot(`
      "@prefix ex: <http://example.org/>.

      ex:dflt ex:p ex:o.

      ex:gA {
      ex:s ex:p ex:o
      }

      ex:gM {
      ex:s ex:p ex:o
      }

      ex:gZ {
      ex:s ex:p ex:o
      }
      "
    `);
  });
});
