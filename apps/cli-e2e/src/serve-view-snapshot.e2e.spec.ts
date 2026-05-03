import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const SELECT_ALL = 'SELECT * WHERE { ?s ?p ?o }';

describe('sparqly serve — view source materialized snapshot', () => {
  let handle: ServeHandle | undefined;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-view-snap-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a view referencing a glob upstream and serves from memory', async () => {
    const ttlPath = join(dir, 'a.ttl');
    await writeFile(
      ttlPath,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:keep ex:p ex:v1 .
        ex:drop ex:p ex:v2 .
      ` + '\n',
    );

    const configPath = join(dir, 'sparqly.serve.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: raw
            glob: "${ttlPath}"
          - id: kept
            default: true
            from: "@raw"
            query: |
              PREFIX ex: <http://example.org/>
              CONSTRUCT { ?s ex:r ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const res = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(SELECT_ALL)}`,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const triples = (
      json.results.bindings as Array<{
        s: { value: string };
        p: { value: string };
        o: { value: string };
      }>
    ).map((b) => `${b.s.value} ${b.p.value} ${b.o.value}`);

    // The target is the `kept` view; the served store is the view's output
    // only — the raw glob is the view's upstream, not a sibling merged in.
    expect(triples).toContain(
      'http://example.org/keep http://example.org/r http://example.org/v1',
    );
    expect(triples).not.toContain(
      'http://example.org/keep http://example.org/p http://example.org/v1',
    );
    expect(triples).not.toContain(
      'http://example.org/drop http://example.org/p http://example.org/v2',
    );
    expect(triples).not.toContain(
      'http://example.org/drop http://example.org/r http://example.org/v2',
    );
  });
});
