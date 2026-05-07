import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_A =
  '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:a ex:p ex:c .\n';
const SAMPLE_B =
  '@prefix ex: <http://example.org/> . ex:a ex:p ex:c . ex:a ex:p ex:d .\n';

const TUPLES_SELECT =
  'PREFIX ex: <http://example.org/> SELECT ?o WHERE { ?s ex:p ?o }';

describe('POST /api/diff', () => {
  let dirA: string;
  let dirB: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dirA = await mkdtemp(join(tmpdir(), 'sparqly-diff-ctl-a-'));
    dirB = await mkdtemp(join(tmpdir(), 'sparqly-diff-ctl-b-'));
    await writeFile(join(dirA, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dirB, 'b.ttl'), SAMPLE_B);
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl'), default: true },
      ],
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}/api/diff`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  async function postJson(body: unknown): Promise<Response> {
    return fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 400 with a structured error when body is malformed (no stack trace)', async () => {
    const resp = await postJson({});
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as { message?: unknown; error?: unknown };
    expect(JSON.stringify(json)).not.toMatch(/at .* \(.*:\d+:\d+\)/);
  });

  it('returns 400 when `left` is not a string', async () => {
    const resp = await postJson({ left: 42, right: '@beta' });
    expect(resp.status).toBe(400);
  });

  it('returns 400 when an unknown key is included in the body', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      bogus: true,
    });
    expect(resp.status).toBe(400);
  });

  it('returns kind=graph with diff/sourceRecords/totals on a glob×glob pair', async () => {
    const resp = await postJson({ left: '@alpha', right: '@beta' });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      diff: { added: string[]; removed: string[]; totals: unknown };
      sourceRecords: { left: Record<string, unknown>; right: Record<string, unknown> };
      totals: { left: number; right: number };
    };
    expect(json.kind).toBe('graph');
    expect(json.totals).toEqual({ left: 2, right: 2 });
    expect(json.diff.added).toEqual([
      '<http://example.org/a> <http://example.org/p> <http://example.org/d> .',
    ]);
    expect(json.diff.removed).toEqual([
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
    ]);
    expect(Object.keys(json.sourceRecords.left).length).toBeGreaterThan(0);
  });

  it('returns kind=tabular with bag-difference rows when both sides project tuples', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      leftQuery: TUPLES_SELECT,
      rightQuery: TUPLES_SELECT,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      variables: string[];
      totals: { left: number; right: number };
      diff: {
        added: { row: Record<string, { value: string }>; count: number }[];
        removed: { row: Record<string, { value: string }>; count: number }[];
      };
    };
    expect(json.kind).toBe('tabular');
    expect(json.variables).toEqual(['o']);
    expect(json.totals).toEqual({ left: 2, right: 2 });
    expect(json.diff.added.map((e) => e.row['o'].value)).toEqual([
      'http://example.org/d',
    ]);
    expect(json.diff.removed.map((e) => e.row['o'].value)).toEqual([
      'http://example.org/b',
    ]);
  });

  it('returns kind=error on mixed-shape inputs (one triples, one tuples)', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      leftQuery:
        'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }',
      rightQuery: TUPLES_SELECT,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      errors: { top?: string };
    };
    expect(json.kind).toBe('error');
    expect(json.errors.top).toMatch(/mixed.*shape|shape mismatch/i);
  });

  it('skipAutoSourceAnnotation in body suppresses source records on glob targets', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      skipAutoSourceAnnotation: true,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      sourceRecords: { left: Record<string, unknown>; right: Record<string, unknown> };
    };
    expect(json.kind).toBe('graph');
    expect(Object.keys(json.sourceRecords.left)).toHaveLength(0);
    expect(Object.keys(json.sourceRecords.right)).toHaveLength(0);
  });
});

describe('POST /api/diff — Single-source mode', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-single-'));
    await writeFile(join(dir, 'a.ttl'), SAMPLE_A);
    server = await createServer({
      sources: join(dir, '*.ttl'),
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}/api/diff`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('does not mount /api/diff in Single-source mode (404)', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ left: '@a', right: '@a' }),
    });
    expect(resp.status).toBe(404);
  });
});
