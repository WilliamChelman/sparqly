import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
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
  timeoutMs = 5000,
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

describe('sparqly serve --watch with views', () => {
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-watch-views-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('refreshes a view when its glob upstream file changes, logging view id and trigger', async () => {
    const ttlPath = join(dir, 'people.ttl');
    await writeFile(
      ttlPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
      ` + '\n',
    );

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: raw
            glob: "${ttlPath}"
          - id: people
            default: true
            from: "@raw"
            query: |
              PREFIX ex: <http://example.org/>
              CONSTRUCT { ?s ex:name ?n } WHERE { ?s ex:name ?n }
      ` + '\n',
    );

    handle = await startServe([
      '--config',
      configPath,
      '--source',
      '@people',
      '--watch',
      '--watch-debounce',
      '100',
      '--verbose',
    ]);

    const before = await fetchNames(handle);
    expect(before).toEqual(['Alice']);

    await writeFile(
      ttlPath,
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

    expect(handle.stderr()).toMatch(
      /Refreshing view "people" \(trigger: file change\)/,
    );
  });

  it('refreshes a TTL-cached view after the TTL expires', async () => {
    let counter = 0;
    const endpoint: FakeSparqlEndpoint = await startFakeSparqlEndpoint(
      ({ query }) => {
        const isAsk = /^\s*ASK\b/i.test(query);
        if (isAsk) {
          return {
            contentType: 'application/sparql-results+json',
            body: JSON.stringify({ head: {}, boolean: true }),
          };
        }
        counter += 1;
        const value = `v${counter}`;
        // The view's query is CONSTRUCT, but the standalone `ep` source in
        // the registry is also bare-materialized via loadEndpointToStore
        // (which sends SELECT ?s ?p ?o WHERE { ?s ?p ?o } and expects SPARQL
        // results JSON). Differentiate by the query verb.
        const isConstruct = /^\s*(?:PREFIX[^\n]*\s+)*CONSTRUCT\b/i.test(query);
        if (isConstruct) {
          return {
            contentType: 'text/turtle',
            body:
              '@prefix ex: <http://example.org/> .\n' +
              `ex:x ex:name ${JSON.stringify(value)} .\n`,
          };
        }
        return {
          contentType: 'application/sparql-results+json',
          body: JSON.stringify({
            head: { vars: ['s', 'p', 'o'] },
            results: {
              bindings: [
                {
                  s: { type: 'uri', value: 'http://example.org/x' },
                  p: { type: 'uri', value: 'http://example.org/name' },
                  o: { type: 'literal', value },
                },
              ],
            },
          }),
        };
      },
    );

    try {
      const cacheDir = join(dir, '.sparqly-cache');
      const configPath = join(dir, 'sparqly.serve.yaml');
      await writeFile(
        configPath,
        dedent`
          sources:
            - id: ep
              endpoint: "${endpoint.url}"
            - id: snap
              default: true
              from: "@ep"
              query: |
                CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }
              cache:
                ttl: "300ms"
                cacheDir: "${cacheDir}"
        ` + '\n',
      );

      handle = await startServe([
        '--config',
        configPath,
        '--source',
        '@snap',
        '--watch',
        '--watch-debounce',
        '50',
        '--watch-poll',
        '100',
        '--verbose',
      ]);

      const initial = await fetchNames(handle);
      expect(initial.length).toBeGreaterThan(0);
      const initialMax = maxV(initial);

      const after = await eventually(
        () => fetchNames(handle as ServeHandle),
        (names) => maxV(names) > initialMax,
        4000,
      );
      expect(maxV(after)).toBeGreaterThan(initialMax);

      expect(handle.stderr()).toMatch(
        /Refreshing view "snap" \(trigger: ttl\)/,
      );
    } finally {
      await endpoint.close();
    }
  });

  it('refreshes a freshness-ASK view when the probe transitions to false', async () => {
    let askResult = true;
    let counter = 0;
    const endpoint: FakeSparqlEndpoint = await startFakeSparqlEndpoint(
      ({ query }) => {
        const isAsk = /^\s*ASK\b/i.test(query);
        if (isAsk) {
          return {
            contentType: 'application/sparql-results+json',
            body: JSON.stringify({ head: {}, boolean: askResult }),
          };
        }
        counter += 1;
        // See note above: the view's CONSTRUCT pass-through expects turtle,
        // but the standalone `ep` source bare-materializes via SELECT which
        // expects SPARQL results JSON. Branch on the query verb.
        const isConstruct = /^\s*(?:PREFIX[^\n]*\s+)*CONSTRUCT\b/i.test(query);
        if (isConstruct) {
          return {
            contentType: 'text/turtle',
            body:
              '@prefix ex: <http://example.org/> .\n' +
              `ex:x ex:name ${JSON.stringify(`r${counter}`)} .\n`,
          };
        }
        return {
          contentType: 'application/sparql-results+json',
          body: JSON.stringify({
            head: { vars: ['s', 'p', 'o'] },
            results: {
              bindings: [
                {
                  s: { type: 'uri', value: 'http://example.org/x' },
                  p: { type: 'uri', value: 'http://example.org/name' },
                  o: { type: 'literal', value: `r${counter}` },
                },
              ],
            },
          }),
        };
      },
    );

    try {
      const cacheDir = join(dir, '.sparqly-cache');
      const configPath = join(dir, 'sparqly.serve.yaml');
      await writeFile(
        configPath,
        dedent`
          sources:
            - id: ep
              endpoint: "${endpoint.url}"
            - id: snap
              default: true
              from: "@ep"
              query: |
                CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }
              cache:
                freshness: |
                  ASK { ?s ?p ?o }
                cacheDir: "${cacheDir}"
        ` + '\n',
      );

      handle = await startServe([
        '--config',
        configPath,
        '--source',
        '@snap',
        '--watch',
        '--watch-debounce',
        '50',
        '--watch-poll',
        '150',
        '--verbose',
      ]);

      const initial = await fetchNames(handle);
      expect(initial.length).toBeGreaterThan(0);
      const initialMax = maxR(initial);

      askResult = false;

      const after = await eventually(
        () => fetchNames(handle as ServeHandle),
        (names) => maxR(names) > initialMax,
        4000,
      );
      expect(maxR(after)).toBeGreaterThan(initialMax);

      expect(handle.stderr()).toMatch(
        /Refreshing view "snap" \(trigger: freshness\)/,
      );
    } finally {
      await endpoint.close();
    }
  });
});

function maxV(names: ReadonlyArray<string>): number {
  return maxByPrefix(names, 'v');
}

function maxR(names: ReadonlyArray<string>): number {
  return maxByPrefix(names, 'r');
}

function maxByPrefix(names: ReadonlyArray<string>, prefix: string): number {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) {
      const v = Number.parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max;
}
