import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';

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

  it('returns 400 with a structured unknown-source-id body when a referenced @id is not served', async () => {
    const resp = await postJson({ left: '@nope', right: '@beta' });
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as {
      kind?: string;
      side?: string;
      id?: string;
      availableIds?: string[];
    };
    expect(json).toMatchObject({
      kind: 'unknown-source-id',
      side: 'left',
      id: 'nope',
    });
    expect(json.availableIds).toEqual(
      expect.arrayContaining(['alpha', 'beta']),
    );
  });

  it('returns 502 with a structured anonymous-view-execution body when an inline graph-mode query fails to execute', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      leftQuery: 'SELECT ?s WHERE { ?s ?p',
      rightQuery: 'SELECT ?s WHERE { ?s ?p',
    });
    expect(resp.status).toBe(502);
    const json = (await resp.json()) as {
      kind?: string;
      side?: string;
      message?: string;
    };
    expect(json.kind).toBe('anonymous-view-execution');
    expect(['left', 'right']).toContain(json.side);
    expect(typeof json.message).toBe('string');
  });

  it('returns kind=grouped carrying a HunkedRdfDiff (one anchor-sorted hunk list + totals) on a glob×glob pair', async () => {
    const resp = await postJson({ left: '@alpha', right: '@beta' });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      hunked: {
        hunks: Array<{
          anchor: string;
          state: string;
          removed: number;
          added: number;
          lines: Array<{ side: string }>;
          sourceRecords: {
            left: Array<{ file: string; line?: number }>;
            right: Array<{ file: string; line?: number }>;
          };
        }>;
        totals: { left: number; right: number };
      };
    };
    expect(json.kind).toBe('grouped');
    expect(json.hunked.totals).toEqual({ left: 2, right: 2 });
    expect(json.hunked.hunks).toHaveLength(1);
    const hunk = json.hunked.hunks[0];
    expect(hunk.anchor).toBe('http://example.org/a');
    expect(hunk.state).toBe('changed');
    expect(hunk.removed).toBe(1);
    expect(hunk.added).toBe(1);
    expect(hunk.sourceRecords.left.length).toBeGreaterThan(0);
    expect(hunk.sourceRecords.right.length).toBeGreaterThan(0);
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

  it('returns kind=error with the structured mixed-shape variant on mixed-shape inputs (one triples, one tuples)', async () => {
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
      errors: {
        top?: { kind: string; triplesSide?: string; tuplesSide?: string };
      };
    };
    expect(json.kind).toBe('error');
    expect(json.errors.top).toEqual({
      kind: 'mixed-shape',
      triplesSide: 'left',
      tuplesSide: 'right',
    });
  });

  it('skipAutoSourceAnnotation in body leaves per-hunk source records empty on glob targets', async () => {
    const resp = await postJson({
      left: '@alpha',
      right: '@beta',
      skipAutoSourceAnnotation: true,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      hunked: {
        hunks: Array<{
          sourceRecords: { left: unknown[]; right: unknown[] };
        }>;
      };
    };
    expect(json.kind).toBe('grouped');
    for (const h of json.hunked.hunks) {
      expect(h.sourceRecords.left).toEqual([]);
      expect(h.sourceRecords.right).toEqual([]);
    }
  });
});

describe('POST /api/diff — single served source', () => {
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

  it('mounts /api/diff; diffing the lone @default source against itself is an empty grouped diff', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ left: '@default', right: '@default' }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      hunked?: { hunks?: unknown[] };
    };
    expect(json.kind).toBe('grouped');
    expect(json.hunked?.hunks ?? []).toEqual([]);
  });
});
