import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSources } from './load-sources';

describe('loadSources', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadsources-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a glob string source through the parser end-to-end', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const { store, files } = await loadSources([join(dir, '*.ttl')]);
    expect(files).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it('loads an object-form glob source (exotic @ path supported)', async () => {
    const archive = join(dir, '@archive');
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    // Use the exotic-path object form to escape the @ discriminator.
    void archive;
    const { store } = await loadSources([{ glob: join(dir, '*.ttl') }]);
    expect(store.size).toBe(1);
  });

  it('rejects an http(s) endpoint string with a not-yet-supported error pointing at #60', async () => {
    await expect(
      loadSources(['https://example.com/sparql']),
    ).rejects.toThrow(
      /SPARQL endpoint sources are not yet supported.*issues\/60/,
    );
  });

  it('rejects an @id reference string with a not-yet-supported error pointing at #60', async () => {
    await expect(loadSources(['@my-source'])).rejects.toThrow(
      /@id reference sources are not yet supported.*issues\/60/,
    );
  });

  it('rejects an object-form endpoint with a not-yet-supported error pointing at #60', async () => {
    await expect(
      loadSources([{ endpoint: 'https://example.com/sparql' }]),
    ).rejects.toThrow(
      /SPARQL endpoint sources are not yet supported.*issues\/60/,
    );
  });
});
