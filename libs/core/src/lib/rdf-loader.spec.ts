import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadRdf } from './rdf-loader';

describe('loadRdf', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads matching Turtle files into an N3.Store', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    await writeFile(
      join(dir, 'b.ttl'),
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .',
    );

    const { store, files } = await loadRdf({ sources: join(dir, '*.ttl') });

    expect(files).toHaveLength(2);
    expect(store.size).toBe(2);
  });

  it('throws when the glob matches no files', async () => {
    await expect(
      loadRdf({ sources: join(dir, 'nope-*.ttl') }),
    ).rejects.toThrow(/no files/i);
  });

  it('throws a parse error mentioning the offending file', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    await expect(loadRdf({ sources: join(dir, '*.ttl') })).rejects.toThrow(
      /broken\.ttl/,
    );
  });
});
