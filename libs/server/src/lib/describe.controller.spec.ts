import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE =
  '@prefix ex: <http://example.org/> .\n' +
  'ex:alice ex:knows ex:bob .\n' +
  'ex:alice ex:age 30 .\n' +
  'ex:carol ex:knows ex:alice .\n';

describe('POST /api/describe — tracer-bullet (single glob source)', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-describe-ctl-'));
    await writeFile(join(dir, 'data.ttl'), SAMPLE);
    server = await createServer({
      sources: [{ id: 'alpha', glob: join(dir, '*.ttl') }],
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}/api/describe`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function postJson(body: unknown): Promise<Response> {
    return fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 400 with a structured error when body is malformed', async () => {
    const resp = await postJson({});
    expect(resp.status).toBe(400);
  });

  it('returns 400 when `iri` is not a string', async () => {
    const resp = await postJson({ iri: 42 });
    expect(resp.status).toBe(400);
  });

  it('returns 200 with the frozen-shape payload for a seed present in the glob source', async () => {
    const resp = await postJson({ iri: 'http://example.org/alice' });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      iri: string;
      quads: string;
      total: number;
      perSource: Record<string, { count: number; truncated: boolean }>;
    };
    expect(json.iri).toBe('http://example.org/alice');
    expect(typeof json.quads).toBe('string');
    // 2 quads with alice as subject + 1 with alice as object.
    expect(json.total).toBe(3);
    expect(json.perSource).toHaveProperty('alpha');
    expect(json.perSource.alpha.count).toBe(3);
    expect(json.perSource.alpha.truncated).toBe(false);
    // N-Quads body carries the three quads in some order.
    expect(json.quads).toContain('http://example.org/alice');
    expect(json.quads).toContain('http://example.org/knows');
    expect(json.quads).toContain('http://example.org/age');
  });

  it('returns 200 with total=0 and an empty N-Quads body when the seed is absent', async () => {
    const resp = await postJson({ iri: 'http://example.org/ghost' });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      iri: string;
      quads: string;
      total: number;
      perSource: Record<string, { count: number; truncated: boolean }>;
    };
    expect(json.total).toBe(0);
    expect(json.quads.trim()).toBe('');
    expect(json.perSource.alpha.count).toBe(0);
  });
});
