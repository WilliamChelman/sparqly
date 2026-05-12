import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createServer, type CreatedServer } from '../bootstrap';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

function recordingLogger(): { logger: SparqlyLogger; entries: RecordedLog[] } {
  const entries: RecordedLog[] = [];
  const record =
    (level: RecordedLog['level']) =>
    (msg: string, fields?: SparqlyLogFields): void => {
      entries.push({ level, msg, fields });
    };
  return {
    entries,
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
  };
}

const SAMPLE =
  '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:a ex:p ex:c .\n';

describe('serve — HTTP request logging interceptor', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;
  let entries: RecordedLog[];

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-reqlog-'));
    await writeFile(join(dir, 'data.ttl'), SAMPLE);
    const rec = recordingLogger();
    entries = rec.entries;
    server = await createServer({
      sources: [{ id: 'files', glob: join(dir, '*.ttl'), default: true }],
      port: 0,
      logger: rec.logger,
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  function requestEvents(): RecordedLog[] {
    return entries.filter((e) => e.msg === 'request');
  }

  it('emits one `request` info event per API request with method, path (no query string), status, ms and bytes', async () => {
    const before = requestEvents().length;
    const resp = await fetch(`${baseUrl}/api/config?foo=bar`);
    expect(resp.status).toBe(200);
    await resp.arrayBuffer();

    const events = requestEvents();
    expect(events.length).toBe(before + 1);
    const ev = events[events.length - 1];
    expect(ev.level).toBe('info');
    expect(ev.fields).toMatchObject({
      method: 'GET',
      path: '/api/config',
      status: 200,
    });
    expect(typeof ev.fields?.['ms']).toBe('number');
    expect(typeof ev.fields?.['bytes']).toBe('number');
    expect(String(ev.fields?.['path'])).not.toContain('?');
  });

  it('records the non-2xx status when a request fails request validation', async () => {
    const resp = await fetch(`${baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(resp.status).toBe(400);
    await resp.arrayBuffer();

    const ev = requestEvents().at(-1);
    expect(ev?.fields).toMatchObject({
      method: 'POST',
      path: '/api/diff',
      status: 400,
    });
  });

  it('includes the error message on a 4xx/5xx response', async () => {
    const resp = await fetch(`${baseUrl}/api/sparql/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'NOT A SPARQL QUERY',
    });
    expect(resp.status).toBeGreaterThanOrEqual(400);
    await resp.arrayBuffer();

    const ev = requestEvents().at(-1);
    expect(Number(ev?.fields?.['status'])).toBeGreaterThanOrEqual(400);
    expect(typeof ev?.fields?.['error']).toBe('string');
    expect(String(ev?.fields?.['error']).length).toBeGreaterThan(0);
  });
});
