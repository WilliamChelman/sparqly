import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';

interface Harness {
  server: CreatedServer;
  base: string;
  sidecarPath: string;
  cleanup: () => Promise<void>;
}

async function startHarness(
  initialSidecarContents?: string,
): Promise<Harness> {
  Logger.overrideLogger(false);
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-saved-queries-'));
  const sidecarPath = join(dir, '.sparqly-queries.yaml');
  if (initialSidecarContents !== undefined) {
    await writeFile(sidecarPath, initialSidecarContents, 'utf8');
  }
  const server = await createServer({
    sources: [{ id: 'blank', empty: true }],
    port: 0,
    savedQueriesPath: sidecarPath,
  });
  return {
    server,
    base: `http://localhost:${server.port}`,
    sidecarPath,
    cleanup: async () => {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('GET /api/saved-queries', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('returns an empty list when the sidecar file does not exist', async () => {
    harness = await startHarness();
    const resp = await fetch(`${harness.base}/api/saved-queries`);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as unknown[];
    expect(json).toEqual([]);
  });

  it('returns summaries (slug, description, hasParameters) for each entry', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '  beta:',
        '    description: second',
        '    body: |',
        '      ASK { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const resp = await fetch(`${harness.base}/api/saved-queries`);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Array<{
      slug: string;
      description?: string;
      hasParameters: boolean;
    }>;
    expect(json.map((e) => e.slug)).toEqual(['alpha', 'beta']);
    expect(json[1].description).toBe('second');
    expect(json[0].hasParameters).toBe(false);
  });
});

describe('GET /api/saved-queries/:slug', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('returns the entry body with an ETag header', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const resp = await fetch(`${harness.base}/api/saved-queries/alpha`);
    expect(resp.status).toBe(200);
    const etag = resp.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const json = (await resp.json()) as { slug: string; body: string };
    expect(json.slug).toBe('alpha');
    expect(json.body.trim()).toBe('SELECT * WHERE { ?s ?p ?o }');
  });

  it('returns 404 for an unknown slug', async () => {
    harness = await startHarness('savedQueries: {}\n');
    const resp = await fetch(`${harness.base}/api/saved-queries/missing`);
    expect(resp.status).toBe(404);
  });
});

describe('PUT /api/saved-queries/:slug', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('creates a new entry with 201 when the slug is fresh', async () => {
    harness = await startHarness();
    const resp = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'alpha',
        body: 'SELECT * WHERE { ?s ?p ?o }',
      }),
    });
    expect(resp.status).toBe(201);
    expect(resp.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/);
    const onDisk = await readFile(harness.sidecarPath, 'utf8');
    expect(onDisk).toContain('alpha:');
    expect(onDisk).toContain('SELECT * WHERE');
  });

  it('updates with 200 and a new ETag when If-Match is current', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const head = await fetch(`${harness.base}/api/saved-queries/alpha`);
    const currentEtag = head.headers.get('etag');
    expect(currentEtag).toBeTruthy();
    const resp = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'if-match': currentEtag as string,
      },
      body: JSON.stringify({
        slug: 'alpha',
        body: 'SELECT ?x WHERE { ?x ?p ?o }',
      }),
    });
    expect(resp.status).toBe(200);
    const newEtag = resp.headers.get('etag');
    expect(newEtag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(newEtag).not.toBe(currentEtag);
  });

  it('returns 412 when If-Match is stale', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const resp = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'if-match': '"deadbeefdeadbeef"',
      },
      body: JSON.stringify({ slug: 'alpha', body: 'SELECT 2 {}' }),
    });
    expect(resp.status).toBe(412);
  });

  it('returns 409 when a PUT without If-Match targets an existing slug (Save-as collision)', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const resp = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'alpha', body: 'SELECT 2 {}' }),
    });
    expect(resp.status).toBe(409);
  });
});

describe('DELETE /api/saved-queries/:slug', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('returns 204 with current If-Match and removes the entry', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '  beta:',
        '    body: |',
        '      ASK { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const head = await fetch(`${harness.base}/api/saved-queries/alpha`);
    const currentEtag = head.headers.get('etag');
    const del = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'DELETE',
      headers: { 'if-match': currentEtag as string },
    });
    expect(del.status).toBe(204);
    const onDisk = await readFile(harness.sidecarPath, 'utf8');
    expect(onDisk).not.toContain('alpha:');
    expect(onDisk).toContain('beta:');
  });

  it('returns 412 with stale If-Match', async () => {
    harness = await startHarness(
      [
        'savedQueries:',
        '  alpha:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const del = await fetch(`${harness.base}/api/saved-queries/alpha`, {
      method: 'DELETE',
      headers: { 'if-match': '"deadbeefdeadbeef"' },
    });
    expect(del.status).toBe(412);
  });
});

describe('/api/config envelope', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('round-trips the saved-queries sidecar path', async () => {
    harness = await startHarness();
    const resp = await fetch(`${harness.base}/api/config`);
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      savedQueries?: { path?: string };
    };
    expect(json.savedQueries?.path).toBe(harness.sidecarPath);
  });
});

describe('concurrent PUTs', () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    if (harness) await harness.cleanup();
    harness = undefined;
  });

  it('serialize through the write mutex so the file is never corrupted', async () => {
    harness = await startHarness();
    const base = harness.base;
    const N = 12;
    const puts = Array.from({ length: N }, (_, i) =>
      fetch(`${base}/api/saved-queries/slug-${i}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: `slug-${i}`,
          body: `SELECT ${i} WHERE { ?s ?p ?o }`,
        }),
      }),
    );
    const responses = await Promise.all(puts);
    for (const r of responses) {
      expect(r.status).toBe(201);
    }
    const onDisk = await readFile(harness.sidecarPath, 'utf8');
    for (let i = 0; i < N; i += 1) {
      expect(onDisk).toContain(`slug-${i}:`);
      expect(onDisk).toContain(`SELECT ${i} WHERE`);
    }
  });
});
