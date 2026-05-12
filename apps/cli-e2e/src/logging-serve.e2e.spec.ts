import { afterEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { startServe, type ServeHandle } from './helpers/serve';

const SOURCE = queryFixture('people.ttl');
const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o } LIMIT 5';

const REQUEST_LINE_RE =
  /\d{2}:\d{2}:\d{2}\.\d{3} INFO \[sparqly\] request .*\bmethod=GET\b.*\bpath=\/api\/sparql\b.*\bstatus=200\b.*\bms=\d+\b.*\bbytes=\d+\b/;
const QUERY_LINE_RE =
  /\d{2}:\d{2}:\d{2}\.\d{3} DEBUG \[sparqly\] query .*\bmode=materialized\b.*\btype=SELECT\b.*\bms=\d+\b/;

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

  it('prints one INFO `request` line per HTTP request on stderr, with no query string in the path', async () => {
    handle = await startServe([SOURCE]);
    await querySparql(handle);

    expect(handle.stderr()).toMatch(REQUEST_LINE_RE);
    expect(handle.stderr()).not.toContain('query=SELECT');
    expect(handle.stderr()).not.toContain('?query=');
  });

  it('--verbose additionally prints a DEBUG `query` line per SPARQL execution the request triggered', async () => {
    handle = await startServe(['--verbose', SOURCE]);
    await querySparql(handle);

    expect(handle.stderr()).toMatch(REQUEST_LINE_RE);
    expect(handle.stderr()).toMatch(QUERY_LINE_RE);
  });

  it('--quiet silences the request lines', async () => {
    handle = await startServe(['--quiet', SOURCE]);
    await querySparql(handle);

    expect(handle.stderr()).not.toMatch(/\brequest\b/);
  });

  it('--log-format json emits the request line as a JSON object', async () => {
    handle = await startServe(['--log-format', 'json', SOURCE]);
    await querySparql(handle);

    const jsonLine = handle
      .stderr()
      .split('\n')
      .find((line) => line.includes('"msg":"request"'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: 'info',
      ctx: 'sparqly',
      msg: 'request',
      method: 'GET',
      path: '/api/sparql',
      status: 200,
    });
    expect(typeof parsed['ms']).toBe('number');
    expect(typeof parsed['bytes']).toBe('number');
  });
});
