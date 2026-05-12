import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffFixture } from './helpers/hash';
import { runCli } from './helpers/run-cli';

/**
 * Regression: ERA shapes ttl (~16k lines, ~50k triples each) used to OOM
 * the v8 heap when run through `diff -f html`. With auto-injected
 * `annotateSource`, the per-side source-record map gets one entry per
 * asserted triple — and the snippet fetcher used to walk the entire map
 * (not just the diff hunks) and fan out one `createReadStream` per unique
 * (file, line). Two real-world ttl files surfaced this in production.
 */
describe('sparqly diff -f html — large real-world input (ERA shapes)', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-large-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('produces an HTML report on two ~850 KB shapes files without exhausting the heap', async () => {
    const reportPath = join(scratch, 'report.html');
    const result = await runCli([
      'diff',
      '--quiet',
      '--format=html',
      `--out=${reportPath}`,
      diffFixture('era-shapes', 'v3.2.1.ttl'),
      diffFixture('era-shapes', 'v3.2.0.ttl'),
    ]);

    expect(result.exitCode).toBe(1);
    const html = await readFile(reportPath, 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toMatch(/<pre[^>]*class="snippet"/);
    expect(html).toContain('<section class="hunks">');
    expect(html).toMatch(/<article class="hunk (removed|added|changed)">/);
  }, 60000);
});
