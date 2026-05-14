import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpException, Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errAsync, okAsync } from 'neverthrow';
import type { DescribeTopLevelError } from 'core';
import { createServer, type CreatedServer } from '../bootstrap';
import { DescribeController } from './describe.controller';
import type {
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

  it('accepts a well-formed `expandedPaths` map; a glob source ignores it (result unchanged)', async () => {
    const resp = await postJson({
      iri: 'http://example.org/alice',
      expandedPaths: {
        alpha: [[{ predicate: 'http://example.org/knows', inverse: false }]],
      },
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      total: number;
      perSource: Record<string, { count: number; truncated: boolean }>;
    };
    // Same as the no-expandedPaths case: alpha is a glob, paths are ignored.
    expect(json.total).toBe(3);
    expect(json.perSource.alpha.count).toBe(3);
    expect(json.perSource.alpha.truncated).toBe(false);
  });

  it('returns 400 when an `expandedPaths` step is malformed (missing `inverse`)', async () => {
    const resp = await postJson({
      iri: 'http://example.org/alice',
      expandedPaths: { alpha: [[{ predicate: 'http://example.org/knows' }]] },
    });
    expect(resp.status).toBe(400);
  });

  it('does not reject an over-long expansion path — the cap clamps rather than 400s', async () => {
    const longPath = Array.from({ length: 30 }, () => ({
      predicate: 'http://example.org/p',
      inverse: false,
    }));
    const resp = await postJson({
      iri: 'http://example.org/alice',
      expandedPaths: { alpha: [longPath] },
    });
    expect(resp.status).toBe(200);
  });
});

describe('DescribeController — result routing through describe-http-errors mapper', () => {
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

  function controllerWithOk(value: DescribeResult): DescribeController {
    const service = {
      runDescribe: () => okAsync(value),
    } as unknown as DescribeService;
    return new DescribeController(service);
  }

  function controllerWithErr(
    error: DescribeTopLevelError,
  ): DescribeController {
    const service = {
      runDescribe: () => errAsync(error),
    } as unknown as DescribeService;
    return new DescribeController(service);
  }

  it('returns 200 on the ok branch with the structured payload as the body', async () => {
    const value: DescribeResult = {
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { alpha: { count: 0, truncated: false } },
    };
    const { res, calls } = fakeRes();
    await controllerWithOk(value).post(
      { iri: 'http://example.org/alice' },
      res,
    );
    expect(calls.status).toBe(200);
    expect(JSON.parse(calls.body)).toEqual(value);
  });

  it('routes all-sources-failed through the mapper as a 502 HttpException', async () => {
    const ctl = controllerWithErr({
      kind: 'all-sources-failed',
      perSource: {
        alpha: {
          kind: 'endpoint-describe',
          endpoint: 'http://ex/sparql',
          message: 'down',
        },
      },
    });
    let caught: HttpException | undefined;
    try {
      await ctl.post({ iri: 'http://example.org/alice' }, fakeRes().res);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(502);
    expect(caught?.getResponse()).toEqual({
      kind: 'all-sources-failed',
      perSource: {
        alpha: {
          kind: 'endpoint-describe',
          endpoint: 'http://ex/sparql',
          message: 'down',
        },
      },
    });
  });

  it('routes the three precondition variants through the mapper as 400 HttpExceptions', async () => {
    const variants: DescribeTopLevelError[] = [
      { kind: 'empty-target' },
      { kind: 'seed-not-iri', value: 'x' },
      { kind: 'reference-target' },
    ];
    for (const error of variants) {
      const ctl = controllerWithErr(error);
      let caught: HttpException | undefined;
      try {
        await ctl.post({ iri: 'http://example.org/alice' }, fakeRes().res);
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(400);
    }
  });
});
