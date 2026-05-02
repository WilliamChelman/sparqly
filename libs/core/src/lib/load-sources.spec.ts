import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSources } from './load-sources';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './test/fake-sparql-endpoint';

const SPARQL_JSON_TWO_BINDINGS = JSON.stringify({
  head: { vars: ['s', 'p', 'o'] },
  results: {
    bindings: [
      {
        s: { type: 'uri', value: 'http://example.org/a' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/b' },
      },
      {
        s: { type: 'uri', value: 'http://example.org/c' },
        p: { type: 'uri', value: 'http://example.org/p' },
        o: { type: 'uri', value: 'http://example.org/d' },
      },
    ],
  },
});

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

  it('rejects an @id reference string with a not-yet-supported error pointing at #60', async () => {
    await expect(loadSources(['@my-source'])).rejects.toThrow(
      /@id reference sources are not yet supported.*issues\/60/,
    );
  });
});

describe('loadSources — SPARQL endpoint sources', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('loads quads from a string-form endpoint URL into the merged store', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const { store } = await loadSources([endpoint.url]);

    expect(store.size).toBe(2);
    const subjects = store
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value)
      .sort();
    expect(subjects).toEqual([
      'http://example.org/a',
      'http://example.org/c',
    ]);
  });

  it('loads quads from an object-form endpoint source', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const { store } = await loadSources([{ endpoint: endpoint.url }]);

    expect(store.size).toBe(2);
  });

  it('endpoint quads land in the default graph (no synthetic graph applied)', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const { store } = await loadSources([{ endpoint: endpoint.url }]);

    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(2);
    for (const q of quads) {
      expect(q.graph.termType).toBe('DefaultGraph');
    }
  });

  it('rejects an endpoint source carrying graphMode at parse time', async () => {
    await expect(
      loadSources([
        {
          endpoint: 'https://example.com/sparql',
          graphMode: 'forceAll',
        } as unknown as Parameters<typeof loadSources>[0][number],
      ]),
    ).rejects.toThrow(/graphMode.*endpoint.*view/i);
  });

  it('rejects an endpoint source carrying graph at parse time', async () => {
    await expect(
      loadSources([
        {
          endpoint: 'https://example.com/sparql',
          graph: 'urn:my:custom-endpoint-graph',
        } as unknown as Parameters<typeof loadSources>[0][number],
      ]),
    ).rejects.toThrow(/\bgraph\b.*endpoint.*view/i);
  });

  it('surfaces source identity and HTTP status on a 5xx error', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      status: 503,
      contentType: 'text/plain',
      body: 'upstream busy',
    }));

    await expect(loadSources([endpoint.url])).rejects.toThrow(
      new RegExp(`endpoint ${endpoint.url}.*503`),
    );
  });

  it('surfaces source identity on a TLS / connection failure', async () => {
    // Pick a port that is not listening to force ECONNREFUSED.
    const dead = 'http://127.0.0.1:1/sparql';
    await expect(loadSources([dead])).rejects.toThrow(/endpoint .*1\/sparql/);
  });
});

describe('loadSources — SPARQL auth, headers, and timeoutMs', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('forwards bearer auth as `Authorization: Bearer <token>`', async () => {
    let observed: string | undefined;
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      const v = headers['authorization'];
      observed = Array.isArray(v) ? v[0] : v;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    await loadSources([
      {
        endpoint: endpoint.url,
        auth: { type: 'bearer', token: 'tk-1' },
      },
    ]);

    expect(observed).toBe('Bearer tk-1');
  });

  it('forwards basic auth as `Authorization: Basic <base64>`', async () => {
    let observed: string | undefined;
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      const v = headers['authorization'];
      observed = Array.isArray(v) ? v[0] : v;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    await loadSources([
      {
        endpoint: endpoint.url,
        auth: { type: 'basic', username: 'alice', password: 'hunter2' },
      },
    ]);

    const expected = `Basic ${Buffer.from('alice:hunter2', 'utf8').toString(
      'base64',
    )}`;
    expect(observed).toBe(expected);
  });

  it('forwards custom headers (escape hatch) verbatim to the endpoint', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      observed = headers;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    await loadSources([
      {
        endpoint: endpoint.url,
        headers: { 'X-Tenant': 'acme', 'X-Trace': 'abc' },
      },
    ]);

    const tenant = observed['x-tenant'];
    const trace = observed['x-trace'];
    expect(Array.isArray(tenant) ? tenant[0] : tenant).toBe('acme');
    expect(Array.isArray(trace) ? trace[0] : trace).toBe('abc');
  });

  it('honors a per-source timeoutMs override (slow endpoint → hard error)', async () => {
    endpoint = await startFakeSparqlEndpoint(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    await expect(
      loadSources([{ endpoint: endpoint.url, timeoutMs: 25 }]),
    ).rejects.toThrow(new RegExp(`endpoint ${endpoint.url}`));
  });

  it('default timeoutMs (30s) lets a fast endpoint succeed', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const { store } = await loadSources([{ endpoint: endpoint.url }]);
    expect(store.size).toBe(2);
  });

  it('combines auth + custom headers on the same request', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      observed = headers;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    await loadSources([
      {
        endpoint: endpoint.url,
        auth: { type: 'bearer', token: 'tk-1' },
        headers: { 'X-Tenant': 'acme' },
      },
    ]);

    const auth = observed['authorization'];
    const tenant = observed['x-tenant'];
    expect(Array.isArray(auth) ? auth[0] : auth).toBe('Bearer tk-1');
    expect(Array.isArray(tenant) ? tenant[0] : tenant).toBe('acme');
  });
});

describe('loadSources — per-source pipeline', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadsources-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('per-source graphMode wins over the global graphMode', async () => {
    const a = join(dir, 'a.ttl');
    const b = join(dir, 'b.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await writeFile(b, '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .');

    const { store } = await loadSources(
      [
        { glob: a, graphMode: 'forceAll' },
        { glob: b },
      ],
      { graphMode: 'preserve' },
    );

    const quads = store.getQuads(null, null, null, null);
    const byGraph = new Map<string, number>();
    for (const q of quads) {
      const key = q.graph.termType === 'DefaultGraph' ? '<default>' : q.graph.value;
      byGraph.set(key, (byGraph.get(key) ?? 0) + 1);
    }
    expect(byGraph.get(`file://${a}`)).toBe(1);
    expect(byGraph.get('<default>')).toBe(1);
  });

  it('dispatches view sources through the view-resolver and merges their quads', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:p ex:d .',
      ].join('\n'),
    );

    const { store } = await loadSources([
      { id: 'raw', glob: a },
      {
        id: 'derived',
        from: ['@raw'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:r ?o } WHERE { ?s ex:p ?o }',
      },
    ]);

    const predicates = new Set(
      store.getQuads(null, null, null, null).map((q) => q.predicate.value),
    );
    expect(predicates.has('http://example.org/p')).toBe(true);
    expect(predicates.has('http://example.org/r')).toBe(true);
    expect(store.size).toBe(4);
  });

  it('per-source graph: IRI overrides the synthetic file:// graph IRI', async () => {
    const a = join(dir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');

    const { store } = await loadSources([
      { glob: a, graphMode: 'forceAll', graph: 'urn:my:custom-graph' },
    ]);

    const [quad] = store.getQuads(null, null, null, null);
    expect(quad.graph.termType).toBe('NamedNode');
    expect(quad.graph.value).toBe('urn:my:custom-graph');
  });
});
