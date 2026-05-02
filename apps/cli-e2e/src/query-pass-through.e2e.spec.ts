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

describe('sparqly query — pass-through federation', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-pt-e2e-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('forwards the user query to a single endpoint URL (no boot-time SELECT-* materialization)', async () => {
    const captured: string[] = [];
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      captured.push(query);
      return {
        contentType: 'application/sparql-results+json',
        body: SPARQL_JSON_TWO_BINDINGS,
      };
    });

    const result = await runCli([
      'query',
      endpoint.url,
      '-q',
      'SELECT ?s WHERE { ?s ?p <urn:my:probe> }',
    ]);

    expect(result.exitCode).toBe(0);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((q) => q.includes('urn:my:probe'))).toBe(true);
    expect(
      captured.every(
        (q) => !/\bSELECT\s+\?s\s+\?p\s+\?o\s+WHERE\s*{\s*\?s\s+\?p\s+\?o\s*}\s*$/i.test(q),
      ),
    ).toBe(true);
  });

  it('view-of-endpoint forces materialization (load-time SELECT against the endpoint)', async () => {
    const captured: string[] = [];
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      captured.push(query);
      return {
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
      };
    });

    const configPath = join(dir, 'sparqly.query.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: ep
            endpoint: "${endpoint.url}"
          - id: snap
            from: ["@ep"]
            query: "PREFIX ex: <http://example.org/> SELECT ?s ?p ?o WHERE { ?s ?p ?o }"
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
    expect(captured.some((q) => /SELECT\s+\?s\s+\?p\s+\?o/i.test(q))).toBe(
      true,
    );
  });
});
