import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n';
const SELECT_S = 'SELECT ?s WHERE { ?s ?p ?o }';

interface ConfigResponse {
  sources: Array<{
    id: string;
    kind: string;
    label: string;
    default?: boolean;
    parentId?: string;
  }>;
}

describe('createServer — splitByFile registry expansion (ADR-0027)', () => {
  let dir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-split-'));
    await writeFile(join(dir, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dir, 'b.ttl'), SAMPLE_B);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('exposes the meta + one kind:file child per matched file in /api/config, with parentId on children only', async () => {
    server = await createServer({
      sources: [
        {
          id: 'docs',
          glob: join(dir, '*.ttl'),
          splitByFile: true,
          default: true,
        },
      ],
      port: 0,
    });

    const resp = await fetch(`http://localhost:${server.port}/api/config`);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as ConfigResponse;

    const byId = new Map(json.sources.map((s) => [s.id, s]));
    expect(byId.get('docs')).toMatchObject({ kind: 'glob', default: true });
    expect(byId.get('docs')?.parentId).toBeUndefined();

    const children = json.sources.filter((s) => s.kind === 'file');
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.parentId === 'docs')).toBe(true);
    expect(children.every((c) => c.default === undefined)).toBe(true);
    expect(children.map((c) => c.id).sort()).toEqual([
      'docs/a.ttl',
      'docs/b.ttl',
    ]);
  });

  it('dispatches POST /api/sparql/<parent>/<file> to the child source', async () => {
    server = await createServer({
      sources: [
        {
          id: 'docs',
          glob: join(dir, '*.ttl'),
          splitByFile: true,
        },
      ],
      port: 0,
    });

    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql/docs/a.ttl`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/sparql-query' },
        body: SELECT_S,
      },
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/a',
    ]);
  });

  it('still dispatches single-segment ids on the wildcard route (backwards-compatible)', async () => {
    server = await createServer({
      sources: [{ id: 'alpha', glob: join(dir, 'a.ttl') }],
      port: 0,
    });

    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql/alpha?query=${encodeURIComponent(SELECT_S)}`,
    );
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/a',
    ]);
  });
});
