import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const SELECT_NAMES =
  'SELECT ?name WHERE { ?s <http://example.org/name> ?name } ORDER BY ?name';

async function fetchNames(handle: ServeHandle): Promise<string[]> {
  const res = await fetch(
    `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_NAMES)}`,
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  return json.results.bindings.map(
    (b: { name: { value: string } }) => b.name.value,
  );
}

async function eventually<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 4000,
): Promise<T> {
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `condition not met within ${timeoutMs}ms (last value: ${JSON.stringify(last)})`,
  );
}

describe('sparqly serve --watch — single-target scoping (ADR-0005)', () => {
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-watch-scope-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('modifying a glob in the target chain triggers exactly one rebuild', async () => {
    const targetPath = join(dir, 'target.ttl');
    const otherPath = join(dir, 'other.ttl');
    await writeFile(
      targetPath,
      '@prefix ex: <http://example.org/> . ex:alice ex:name "Alice" .\n',
    );
    await writeFile(
      otherPath,
      '@prefix ex: <http://example.org/> . ex:zoe ex:name "Zoe" .\n',
    );

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: target
            default: true
            glob: "${targetPath}"
          - id: other
            glob: "${otherPath}"
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--watch',
      '--watch-debounce',
      '100',
      '--verbose',
    ]);

    const before = await fetchNames(handle);
    expect(before).toEqual(['Alice']);

    await writeFile(
      targetPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
        ex:bob ex:name "Bob" .
      ` + '\n',
    );

    const after = await eventually(
      () => fetchNames(handle as ServeHandle),
      (names) => names.includes('Bob'),
    );
    expect(after).toEqual(['Alice', 'Bob']);

    const rebuilds = (handle.stderr().match(/Rebuilt store/g) ?? []).length;
    expect(rebuilds).toBe(1);
  });

  it('modifying a glob belonging to an untargeted entry does NOT trigger a rebuild', async () => {
    const targetPath = join(dir, 'target.ttl');
    const otherPath = join(dir, 'other.ttl');
    await writeFile(
      targetPath,
      '@prefix ex: <http://example.org/> . ex:alice ex:name "Alice" .\n',
    );
    await writeFile(
      otherPath,
      '@prefix ex: <http://example.org/> . ex:zoe ex:name "Zoe" .\n',
    );

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: target
            default: true
            glob: "${targetPath}"
          - id: other
            glob: "${otherPath}"
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--watch',
      '--watch-debounce',
      '100',
      '--verbose',
    ]);

    const before = await fetchNames(handle);
    expect(before).toEqual(['Alice']);

    // Modify the untargeted glob's file. Should NOT trigger any rebuild.
    await writeFile(
      otherPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:zoe ex:name "Zoe" .
        ex:yan ex:name "Yan" .
      ` + '\n',
    );

    // Wait well past the debounce window for any rebuild that would have fired.
    await new Promise((r) => setTimeout(r, 500));

    const after = await fetchNames(handle);
    expect(after).toEqual(['Alice']);

    const rebuilds = (handle.stderr().match(/Rebuilt store/g) ?? []).length;
    expect(rebuilds).toBe(0);
  });
});
