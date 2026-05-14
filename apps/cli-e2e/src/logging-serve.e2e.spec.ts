import { afterEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { startServe, type ServeHandle } from './helpers/serve';

const SOURCE = queryFixture('people.ttl');
const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';

async function querySparql(handle: ServeHandle): Promise<void> {
  const res = await fetch(
    `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`,
  );
  await res.arrayBuffer();
}

describe('sparqly serve — boundary logging', () => {
  let handle: ServeHandle | undefined;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
  });

  it('does not leak the query string into request logs', async () => {
    handle = await startServe([SOURCE]);
    await querySparql(handle);

    expect(handle.stderr()).not.toContain('query=SELECT');
    expect(handle.stderr()).not.toContain('?query=');
  });

  it('--quiet silences the request and startup lines', async () => {
    handle = await startServe(['--quiet', SOURCE]);
    await querySparql(handle);

    expect(handle.stderr()).not.toMatch(/\brequest\b/);
    expect(handle.stderr()).not.toMatch(/\bserve-ready\b/);
  });
});
