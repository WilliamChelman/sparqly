import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadQuerySources } from './load-query-sources';
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
    ],
  },
});

describe('loadQuerySources — pass-through eligibility', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('returns pass-through for a single endpoint URL with no prefilter and does not contact the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const result = await loadQuerySources([endpoint.url]);

    expect(result.mode).toBe('pass-through');
    if (result.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.endpoint.kind).toBe('endpoint');
    expect(result.endpoint.endpoint).toBe(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('returns pass-through for a single object-form endpoint with auth/headers/timeoutMs preserved', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));

    const result = await loadQuerySources([
      {
        endpoint: endpoint.url,
        auth: { type: 'bearer', token: 'tk-1' },
        headers: { 'X-Tenant': 'acme' },
        timeoutMs: 1234,
      },
    ]);

    expect(result.mode).toBe('pass-through');
    if (result.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.endpoint.auth).toEqual({ type: 'bearer', token: 'tk-1' });
    expect(result.endpoint.headers).toEqual({ 'X-Tenant': 'acme' });
    expect(result.endpoint.timeoutMs).toBe(1234);
    expect(endpoint.requestCount()).toBe(0);
  });
});

describe('loadQuerySources — materialization fallbacks', () => {
  let dir: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadquerysources-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a single glob source', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const result = await loadQuerySources([join(dir, '*.ttl')]);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it('materializes a registry of {endpoint, view-of-endpoint} via the view path', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: JSON.stringify({
        head: { vars: ['s', 'p', 'o'] },
        results: {
          bindings: [
            {
              s: { type: 'uri', value: 'http://example.org/keep' },
              p: { type: 'uri', value: 'http://example.org/p' },
              o: { type: 'uri', value: 'http://example.org/v1' },
            },
          ],
        },
      }),
    }));

    const result = await loadQuerySources([
      { id: 'ep', endpoint: endpoint.url },
      {
        id: 'snap',
        from: ['@ep'],
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBeGreaterThan(0);
  });
});

describe('loadQuerySources — view forces materialization', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadquerysources-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a registry that includes a view (raw glob + view)', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const result = await loadQuerySources([
      { id: 'raw', glob: join(dir, '*.ttl') },
      {
        id: 'derived',
        from: ['@raw'],
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBeGreaterThan(0);
  });
});

describe('loadQuerySources — multi-source materialization', () => {
  let dir: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loadquerysources-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a raw endpoint mixed with a glob source (no pass-through)', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: SPARQL_JSON_TWO_BINDINGS,
    }));
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const result = await loadQuerySources([endpoint.url, join(dir, '*.ttl')]);

    expect(result.mode).toBe('materialized');
    if (result.mode !== 'materialized') throw new Error('unreachable');
    expect(result.store.size).toBeGreaterThan(0);
    expect(endpoint.requestCount()).toBeGreaterThan(0);
  });
});
