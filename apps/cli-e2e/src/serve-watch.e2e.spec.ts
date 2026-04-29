import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
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

async function eventuallyContains(
  handle: ServeHandle,
  expected: string,
  timeoutMs = 5000,
): Promise<string[]> {
  const start = Date.now();
  let last: string[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await fetchNames(handle);
    if (last.includes(expected)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `expected name "${expected}" not visible within ${timeoutMs}ms (saw: ${last.join(', ')})`,
  );
}

describe('sparqly serve — watch mode', () => {
  let scratch: string;
  let dataPath: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-watch-'));
    dataPath = join(scratch, 'data.ttl');
    await copyFile(queryFixture('people.ttl'), dataPath);
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('without --watch, edits are not reflected in subsequent queries (US 18)', async () => {
    const handle = await startServe([dataPath]);
    try {
      const before = await fetchNames(handle);
      expect(before).not.toContain('Dave');

      await writeFile(
        dataPath,
        '@prefix ex: <http://example.org/> .\nex:dave ex:name "Dave" .\n',
      );
      await new Promise((r) => setTimeout(r, 600));

      const after = await fetchNames(handle);
      expect(after).toEqual(before);
    } finally {
      await handle.close();
    }
  });

  it('--watch picks up file edits after the debounce window (US 16)', async () => {
    const handle = await startServe([dataPath, '--watch', '--watch-debounce', '100']);
    try {
      const before = await fetchNames(handle);
      expect(before).not.toContain('Dave');

      await writeFile(
        dataPath,
        '@prefix ex: <http://example.org/> .\nex:dave ex:name "Dave" .\n',
      );

      const after = await eventuallyContains(handle, 'Dave');
      expect(after).toContain('Dave');
    } finally {
      await handle.close();
    }
  });

  it('--watch debounces rapid edits into a single rebuild (US 17)', async () => {
    const handle = await startServe([
      dataPath,
      '--watch',
      '--watch-debounce',
      '300',
      '--verbose',
    ]);
    try {
      await fetchNames(handle);

      for (const name of ['One', 'Two', 'Three', 'Four']) {
        await writeFile(
          dataPath,
          `@prefix ex: <http://example.org/> .\nex:x ex:name "${name}" .\n`,
        );
        await new Promise((r) => setTimeout(r, 50));
      }

      await eventuallyContains(handle, 'Four');

      const rebuilds = (handle.stderr().match(/Rebuilt store/g) ?? []).length;
      expect(rebuilds).toBeLessThan(4);
      expect(rebuilds).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.close();
    }
  });
});
