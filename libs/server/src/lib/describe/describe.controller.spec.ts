import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';
import { DescribeController } from './describe.controller';
import type {
  DescribeResponse,
  DescribeResult,
  DescribeService,
} from './describe.service';

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

  it('injects `urn:sparqly:fromSource` provenance annotations by default (withProvenance defaults to true)', async () => {
    const resp = await postJson({ iri: 'http://example.org/alice' });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as { quads: string };
    expect(json.quads).toContain('urn:sparqly:fromSource');
  });

  it('omits `urn:sparqly:fromSource` annotations from the wire when `withProvenance: false`, leaving total/count unchanged', async () => {
    const resp = await postJson({
      iri: 'http://example.org/alice',
      withProvenance: false,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      quads: string;
      total: number;
      perSource: Record<string, { count: number }>;
    };
    expect(json.quads).not.toContain('urn:sparqly:fromSource');
    // Same merged quad set as the provenance-on case (2 alice-subject + 1 alice-object).
    expect(json.total).toBe(3);
    expect(json.perSource.alpha.count).toBe(3);
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

describe('DescribeController — service-status to HTTP mapping', () => {
  interface FakeRes {
    status(code: number): FakeRes;
    setHeader(name: string, value: string): FakeRes;
    send(body: string): FakeRes;
  }

  function fakeRes(): { res: FakeRes; calls: { status: number; body: string } } {
    const calls = { status: 0, body: '' };
    const res: FakeRes = {
      status(code) {
        calls.status = code;
        return res;
      },
      setHeader() {
        return res;
      },
      send(body) {
        calls.body = body;
        return res;
      },
    };
    return { res, calls };
  }

  function controllerWith(result: DescribeResult): DescribeController {
    const service = {
      runDescribe: async () => result,
    } as unknown as DescribeService;
    return new DescribeController(service);
  }

  it("maps status 'all-sources-failed' to HTTP 502 with the per-source error map as the body", async () => {
    const response: DescribeResponse = {
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { alpha: { count: 0, truncated: false, error: 'boom' } },
    };
    const { res, calls } = fakeRes();
    await controllerWith({ status: 'all-sources-failed', response }).post(
      { iri: 'http://example.org/alice' },
      res,
    );
    expect(calls.status).toBe(502);
    expect(JSON.parse(calls.body)).toEqual(response);
  });

  it("maps status 'ok' to HTTP 200", async () => {
    const response: DescribeResponse = {
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { alpha: { count: 0, truncated: false } },
    };
    const { res, calls } = fakeRes();
    await controllerWith({ status: 'ok', response }).post(
      { iri: 'http://example.org/alice' },
      res,
    );
    expect(calls.status).toBe(200);
    expect(JSON.parse(calls.body)).toEqual(response);
  });
});
