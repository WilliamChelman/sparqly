import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .';

describe('createServer — served registry', () => {
  let dirA: string;
  let dirB: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dirA = await mkdtemp(join(tmpdir(), 'sparqly-reg-a-'));
    dirB = await mkdtemp(join(tmpdir(), 'sparqly-reg-b-'));
    await writeFile(join(dirA, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dirB, 'b.ttl'), SAMPLE_B);
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl'), default: true },
        { id: 'remote', endpoint: 'http://127.0.0.1:1/sparql' },
      ],
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  it('GET /api/config lists every non-reference source with id, kind, label, default? alongside the context block', async () => {
    const resp = await fetch(`${baseUrl}/api/config`);

    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      sources: Array<{
        id: string;
        kind: string;
        label: string;
        default?: boolean;
      }>;
      context: { prefixes: Record<string, string>; base?: string };
      describe: {
        perSourceSoftLimit: number;
        perSourceHardLimit: number;
        fromSourcePredicate: string;
      };
    };
    expect(json.sources).toHaveLength(3);
    const byId = new Map(json.sources.map((s) => [s.id, s]));
    expect(byId.get('alpha')).toMatchObject({ kind: 'glob' });
    expect(byId.get('beta')).toMatchObject({ kind: 'glob', default: true });
    expect(byId.get('remote')).toMatchObject({ kind: 'endpoint' });
    expect(byId.get('alpha')?.default).toBeUndefined();
    expect(json.context).toBeDefined();
    expect(json.context.prefixes).toBeDefined();
    // `describe:` block omitted from createServer → defaults surface here.
    expect(json.describe).toEqual({
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    });
  });

  it('GET /api/config surfaces a configured `describe:` block, filling missing fields with defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-reg-desc-'));
    await writeFile(join(dir, 'd.ttl'), SAMPLE_A);
    const local = await createServer({
      sources: [{ id: 'alpha', glob: join(dir, '*.ttl') }],
      port: 0,
      describe: { perSourceHardLimit: 42 },
    });
    try {
      const resp = await fetch(`http://localhost:${local.port}/api/config`);
      const json = (await resp.json()) as {
        describe: {
          perSourceSoftLimit: number;
          perSourceHardLimit: number;
          fromSourcePredicate: string;
        };
      };
      expect(json.describe).toEqual({
        perSourceSoftLimit: 10000,
        perSourceHardLimit: 42,
        fromSourcePredicate: 'urn:sparqly:fromSource',
      });
    } finally {
      await local.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('GET /api/sparql/:id returns SPARQL JSON results for the named source', async () => {
    const resp = await fetch(
      `${baseUrl}/api/sparql/alpha?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p ?o }',
      )}`,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/a',
    ]);
  });

  it('GET /api/sparql/:id scopes to that source (other sources do not leak in)', async () => {
    const resp = await fetch(
      `${baseUrl}/api/sparql/beta?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p ?o }',
      )}`,
    );

    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/c',
    ]);
  });

  it('GET /api/sparql/:id returns 404 for an unknown @id', async () => {
    const resp = await fetch(
      `${baseUrl}/api/sparql/nope?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
    );

    expect(resp.status).toBe(404);
  });

  it('POST /api/sparql/:id with application/sparql-query body works', async () => {
    const resp = await fetch(`${baseUrl}/api/sparql/alpha`, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'SELECT ?s WHERE { ?s ?p ?o }',
    });

    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/a',
    ]);
  });
});

describe('createServer — scope filter', () => {
  let dirA: string;
  let dirB: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dirA = await mkdtemp(join(tmpdir(), 'sparqly-scope-a-'));
    dirB = await mkdtemp(join(tmpdir(), 'sparqly-scope-b-'));
    await writeFile(join(dirA, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dirB, 'b.ttl'), SAMPLE_B);
  });

  afterAll(async () => {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  it('scope `@id` narrows the served/listed set; filtered ids 404', async () => {
    const server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl') },
      ],
      scope: '@alpha',
      port: 0,
    });
    try {
      const base = `http://localhost:${server.port}`;
      const cfg = (await (await fetch(`${base}/api/config`)).json()) as {
        sources: Array<{ id: string }>;
      };
      expect(cfg.sources.map((s) => s.id)).toEqual(['alpha']);
      const beta = await fetch(
        `${base}/api/sparql/beta?query=${encodeURIComponent('ASK { ?s ?p ?o }')}`,
      );
      expect(beta.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('rejects an `@id` scope that matches no source, listing the available ids', async () => {
    await expect(
      createServer({
        sources: [{ id: 'alpha', glob: join(dirA, '*.ttl') }],
        scope: '@nope',
        port: 0,
      }),
    ).rejects.toThrow(/@nope[\s\S]*@alpha/);
  });
});
