import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

const SPARQL_JSON_ONE_BINDING = JSON.stringify({
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

describe('sparqly query — SPARQL endpoint auth, headers, and timeoutMs', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-auth-e2e-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('forwards bearer auth and a custom header to the endpoint via a config file', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      observed = headers;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_ONE_BINDING,
      };
    });

    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - endpoint: "${endpoint.url}"
            auth:
              type: bearer
              token: tk-1
            headers:
              X-Tenant: acme
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: {} },
    );

    expect(result.exitCode).toBe(0);
    const auth = observed['authorization'];
    const tenant = observed['x-tenant'];
    expect(Array.isArray(auth) ? auth[0] : auth).toBe('Bearer tk-1');
    expect(Array.isArray(tenant) ? tenant[0] : tenant).toBe('acme');
  });

  it('forwards basic auth as Authorization: Basic <base64>', async () => {
    let observed: string | undefined;
    endpoint = await startFakeSparqlEndpoint(({ headers }) => {
      const v = headers['authorization'];
      observed = Array.isArray(v) ? v[0] : v;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_ONE_BINDING,
      };
    });

    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - endpoint: "${endpoint.url}"
            auth:
              type: basic
              username: alice
              password: hunter2
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: {} },
    );

    expect(result.exitCode).toBe(0);
    const expected = `Basic ${Buffer.from('alice:hunter2', 'utf8').toString(
      'base64',
    )}`;
    expect(observed).toBe(expected);
  });

  it('rejects auth + a colliding Authorization header before any network call', async () => {
    let requestCount = 0;
    endpoint = await startFakeSparqlEndpoint(() => {
      requestCount += 1;
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_ONE_BINDING,
      };
    });

    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - endpoint: "${endpoint.url}"
            auth:
              type: bearer
              token: tk-1
            headers:
              Authorization: "Bearer other"
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: {} },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/auth.*Authorization.*collide/i);
    expect(requestCount).toBe(0);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('honors a per-source timeoutMs override (slow endpoint surfaces a hard error)', async () => {
    endpoint = await startFakeSparqlEndpoint(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_ONE_BINDING,
      };
    });

    const url = endpoint.url;
    const configPath = join(scratch, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - endpoint: "${url}"
            timeoutMs: 25
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        '--config',
        configPath,
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: {} },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(url);
  });
});
