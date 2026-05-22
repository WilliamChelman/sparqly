import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordingLogger } from '../test/recording-logger';
import type { ParsedGlobSource } from './source-spec';
import { warnIfOversizedGlob } from './oversized-glob-hint';

function globSource(over: Partial<ParsedGlobSource> = {}): ParsedGlobSource {
  return { kind: 'glob', glob: 'data/**/*.ttl', ...over };
}

describe('warnIfOversizedGlob', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-oversized-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSized(name: string, bytes: number): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(bytes));
    return path;
  }

  it('warns once, naming `storage: disk`, when an un-flagged glob exceeds the threshold', async () => {
    const paths = [
      await writeSized('a.ttl', 150),
      await writeSized('b.ttl', 120),
    ];
    const { logger, entries } = recordingLogger();

    await warnIfOversizedGlob(globSource(), paths, {
      logger,
      thresholdBytes: 200,
    });

    const warnings = entries.filter((e) => e.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toContain('storage: disk');
  });

  it('stays silent when the matched bytes are at or below the threshold', async () => {
    const paths = [
      await writeSized('a.ttl', 80),
      await writeSized('b.ttl', 90),
    ];
    const { logger, entries } = recordingLogger();

    await warnIfOversizedGlob(globSource(), paths, {
      logger,
      thresholdBytes: 200,
    });

    expect(entries).toEqual([]);
  });

  it('stays silent for a glob already declared `storage: disk`', async () => {
    const paths = [
      await writeSized('a.ttl', 150),
      await writeSized('b.ttl', 120),
    ];
    const { logger, entries } = recordingLogger();

    await warnIfOversizedGlob(globSource({ storage: 'disk' }), paths, {
      logger,
      thresholdBytes: 200,
    });

    expect(entries).toEqual([]);
  });

  it('skips a path that cannot be stat-ed instead of crashing the hint', async () => {
    const paths = [
      await writeSized('here.ttl', 250),
      join(dir, 'vanished.ttl'),
    ];
    const { logger, entries } = recordingLogger();

    await expect(
      warnIfOversizedGlob(globSource(), paths, {
        logger,
        thresholdBytes: 200,
      }),
    ).resolves.toBeUndefined();

    const warnings = entries.filter((e) => e.level === 'warn');
    expect(warnings).toHaveLength(1);
  });
});
