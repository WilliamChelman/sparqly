import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

/**
 * End-to-end coverage for the observable serve path of the local-source Query
 * cache (ADR-0054, #415): an opted-in materialized glob reports
 * `X-Sparqly-Cache: miss` on the first query and `hit` on an identical repeat,
 * and editing the matched file folds a new freshness token into the key so the
 * next identical query misses again — automatically, with no manual eviction.
 */
describe('sparqly serve — local-source Query cache header (#415)', () => {
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-cache-local-'));
    // A `.git` boundary stops config auto-discovery walking onto the host.
    await mkdir(join(dir, '.git'));
    await mkdir(join(dir, 'data'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function writeData(turtle: string): Promise<void> {
    await writeFile(join(dir, 'data', 'a.ttl'), turtle);
  }

  it('reports miss then hit, and misses again after the matched file is edited', async () => {
    await writeData('@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: vocab
            glob: data/*.ttl
            queryCache: true
            default: true
      ` + '\n',
    );

    handle = await startServe([], { cwd: dir });
    const probe = 'SELECT ?s WHERE { ?s ?p ?o }';
    const url = `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(probe)}`;

    const first = await fetch(url);
    await first.arrayBuffer();
    expect(first.status).toBe(200);
    expect(first.headers.get('x-sparqly-cache')).toBe('miss');

    const second = await fetch(url);
    await second.arrayBuffer();
    expect(second.status).toBe(200);
    expect(second.headers.get('x-sparqly-cache')).toBe('hit');

    // Edit the matched file (different byte length): the stat-digest freshness
    // token moves, so the same query is a new key — a miss, recomputed.
    await writeData(
      '@prefix ex: <http://example.org/> . ex:changed ex:p ex:b . ex:more ex:p ex:b .',
    );
    const third = await fetch(url);
    await third.arrayBuffer();
    expect(third.status).toBe(200);
    expect(third.headers.get('x-sparqly-cache')).toBe('miss');
  });
});
