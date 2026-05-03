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

const DATA_TURTLE =
  '@prefix ex: <http://example.org/> .\n' +
  'ex:keep ex:p ex:v1 .\n' +
  'ex:drop ex:p ex:v2 .\n';

describe('sparqly serve — empty source with SERVICE composition', () => {
  let handle: ServeHandle | undefined;
  let endpoint: FakeSparqlEndpoint | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-empty-svc-e2e-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    if (endpoint) await endpoint.close();
    handle = undefined;
    endpoint = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves a view from an empty source whose query uses SERVICE against an external endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      if (/^\s*ASK\b/i.test(query)) {
        return {
          contentType: 'application/sparql-results+json',
          body: JSON.stringify({ head: {}, boolean: true }),
        };
      }
      return { contentType: 'text/turtle', body: DATA_TURTLE };
    });

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: composer
            empty: true
          - id: composed
            default: true
            from: "@composer"
            query: |
              CONSTRUCT { ?s ?p ?o } WHERE {
                SERVICE <${endpoint.url}> { ?s ?p ?o }
              }
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const res = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p ?o } ORDER BY ?s',
      )}`,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    const subjects = json.results.bindings.map((b) => b.s.value);
    expect(subjects).toEqual([
      'http://example.org/drop',
      'http://example.org/keep',
    ]);
  });
});
