import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const SELECT_NAMES =
  'SELECT ?name WHERE { ?s <http://example.org/name> ?name } ORDER BY ?name';

async function fetchNames(
  handle: ServeHandle,
  id: string,
): Promise<string[]> {
  const res = await fetch(
    `${handle.baseUrl}/api/sparql/${id}?query=${encodeURIComponent(SELECT_NAMES)}`,
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    results: { bindings: Array<{ name: { value: string } }> };
  };
  return json.results.bindings.map((b) => b.name.value);
}

async function eventuallyContains(
  handle: ServeHandle,
  id: string,
  expected: string,
  timeoutMs = 5000,
): Promise<string[]> {
  const start = Date.now();
  let last: string[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await fetchNames(handle, id);
    if (last.includes(expected)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `expected name "${expected}" on @${id} not visible within ${timeoutMs}ms (saw: ${last.join(', ')})`,
  );
}

describe('sparqly serve — Registry mode --watch (issue #143)', () => {
  let scratch: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-registry-watch-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('rebuild reflects in /api/sparql/<id> only for the touched source', async () => {
    const alphaDir = join(scratch, 'alpha');
    const betaDir = join(scratch, 'beta');
    await rm(alphaDir, { recursive: true, force: true });
    await rm(betaDir, { recursive: true, force: true });
    await writeFile(
      join(scratch, 'alpha-data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:name "Alice" .\n',
    );
    await writeFile(
      join(scratch, 'beta-data.ttl'),
      '@prefix ex: <http://example.org/> . ex:b ex:name "Bob" .\n',
    );

    const configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${join(scratch, 'alpha-data.ttl')}"
          - id: beta
            glob: "${join(scratch, 'beta-data.ttl')}"
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--watch',
      '--watch-debounce',
      '100',
    ]);

    expect(await fetchNames(handle, 'alpha')).toEqual(['Alice']);
    expect(await fetchNames(handle, 'beta')).toEqual(['Bob']);

    await writeFile(
      join(scratch, 'alpha-data.ttl'),
      '@prefix ex: <http://example.org/> . ex:dave ex:name "Dave" .\n',
    );

    const alphaAfter = await eventuallyContains(handle, 'alpha', 'Dave');
    expect(alphaAfter).toEqual(['Dave']);

    // Beta is unchanged — no rebuild should have touched it.
    expect(await fetchNames(handle, 'beta')).toEqual(['Bob']);
  });
});
