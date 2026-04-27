import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from './create-server';

const SAMPLE_TTL = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .';

describe('W3C SPARQL Protocol endpoint', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-server-'));
    await writeFile(join(dir, 'data.ttl'), SAMPLE_TTL);
    server = await createServer({
      sources: join(dir, '*.ttl'),
      port: 0,
    });
    baseUrl = `http://localhost:${server.port}/api/sparql`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('GET ?query= returns SPARQL JSON results for SELECT', async () => {
    const resp = await fetch(
      `${baseUrl}?query=${encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }')}`,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
    const json = await resp.json();
    expect(json.head.vars).toEqual(['s']);
    expect(json.results.bindings[0].s.value).toBe('http://example.org/a');
  });

  it('GET CONSTRUCT returns Turtle by default', async () => {
    const resp = await fetch(
      `${baseUrl}?query=${encodeURIComponent('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')}`,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/turtle/);
    const body = await resp.text();
    expect(body).toContain('http://example.org/a');
  });

  it('POST application/x-www-form-urlencoded with query field works', async () => {
    const body = new URLSearchParams({
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
    }).toString();

    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
    const json = await resp.json();
    expect(json.results.bindings).toHaveLength(1);
  });

  it('POST application/sparql-query with raw query body works', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'SELECT ?s WHERE { ?s ?p ?o }',
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
    const json = await resp.json();
    expect(json.results.bindings).toHaveLength(1);
  });

  it('honours Accept: text/turtle for CONSTRUCT', async () => {
    const resp = await fetch(
      `${baseUrl}?query=${encodeURIComponent('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')}`,
      { headers: { accept: 'text/turtle' } },
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/turtle/);
  });

  it('honours Accept: application/sparql-results+json for SELECT', async () => {
    const resp = await fetch(
      `${baseUrl}?query=${encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }')}`,
      { headers: { accept: 'application/sparql-results+json' } },
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
  });

  it('returns 400 when GET has no query parameter', async () => {
    const resp = await fetch(baseUrl);
    expect(resp.status).toBe(400);
  });

  it('returns 400 when POST form body has no query field', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(resp.status).toBe(400);
  });

  it('returns 415 for unsupported POST content type', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"SELECT ?s WHERE { ?s ?p ?o }"}',
    });
    expect(resp.status).toBe(415);
  });

  it('returns 400 for a malformed SPARQL query', async () => {
    const resp = await fetch(
      `${baseUrl}?query=${encodeURIComponent('SELECT ?s WHERE { ?s ?p')}`,
    );
    expect(resp.status).toBe(400);
  });

  it('rejects UPDATE by default with 400 and the immutability message', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
    });

    expect(resp.status).toBe(400);
    const body = await resp.text();
    expect(body).toMatch(/Mutating queries are disabled/);
  });
});

describe('W3C SPARQL Protocol endpoint with --mutable', () => {
  let dir: string;
  let server: CreatedServer;
  let baseUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dir = await mkdtemp(join(tmpdir(), 'sparqly-server-mut-'));
    await writeFile(join(dir, 'data.ttl'), SAMPLE_TTL);
    server = await createServer({
      sources: join(dir, '*.ttl'),
      port: 0,
      mutable: true,
    });
    baseUrl = `http://localhost:${server.port}/api/sparql`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('lets UPDATE past the guard (engine then errors with not-implemented)', async () => {
    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: 'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
    });

    expect(resp.status).toBe(400);
    const body = await resp.text();
    expect(body).toMatch(/not yet implemented/i);
    expect(body).not.toMatch(/Mutating queries are disabled/);
  });
});

describe('createServer with webRootDir', () => {
  let dataDir: string;
  let webDir: string;
  let server: CreatedServer;
  let rootUrl: string;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-server-data-'));
    webDir = await mkdtemp(join(tmpdir(), 'sparqly-server-web-'));
    await writeFile(join(dataDir, 'data.ttl'), SAMPLE_TTL);
    await writeFile(
      join(webDir, 'index.html'),
      '<!doctype html><title>sparqly</title><div id="yasgui-marker"></div>',
    );
    server = await createServer({
      sources: join(dataDir, '*.ttl'),
      port: 0,
      webRootDir: webDir,
    });
    rootUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(webDir, { recursive: true, force: true });
  });

  it('serves the bundled index.html at /', async () => {
    const resp = await fetch(`${rootUrl}/`);

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/html/);
    const body = await resp.text();
    expect(body).toContain('yasgui-marker');
  });

  it('still routes /api/sparql to the SPARQL controller', async () => {
    const resp = await fetch(
      `${rootUrl}/api/sparql?query=${encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }')}`,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/sparql-results\+json/);
  });
});
