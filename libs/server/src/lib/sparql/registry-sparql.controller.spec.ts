import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type CreatedServer } from '../bootstrap';

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n';
const SELECT_S = 'SELECT ?s WHERE { ?s ?p ?o }';

describe('RegistrySparqlController — /api/sparql alias', () => {
  let dirA: string;
  let dirB: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dirA = await mkdtemp(join(tmpdir(), 'sparqly-alias-a-'));
    dirB = await mkdtemp(join(tmpdir(), 'sparqly-alias-b-'));
    await writeFile(join(dirA, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dirB, 'b.ttl'), SAMPLE_B);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });

  it('forwards GET /api/sparql to the `default: true` source', async () => {
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl'), default: true },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql?query=${encodeURIComponent(
        SELECT_S,
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

  it('forwards POST /api/sparql to the sole served source even without a default marker', async () => {
    server = await createServer({
      sources: [{ id: 'alpha', glob: join(dirA, '*.ttl') }],
      port: 0,
    });
    const resp = await fetch(`http://localhost:${server.port}/api/sparql`, {
      method: 'POST',
      headers: { 'content-type': 'application/sparql-query' },
      body: SELECT_S,
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/a',
    ]);
  });

  it('returns 400 with a structured no-default-multi body when 2+ sources are served with no default', async () => {
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl') },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as {
      kind?: string;
      availableIds?: string[];
    };
    expect(json.kind).toBe('no-default-multi');
    expect(json.availableIds).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('returns 502 with a structured query-execution body when the SPARQL query is malformed', async () => {
    server = await createServer({
      sources: [{ id: 'alpha', glob: join(dirA, '*.ttl'), default: true }],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql/alpha?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p',
      )}`,
    );
    expect(resp.status).toBe(502);
    const json = (await resp.json()) as {
      kind?: string;
      query?: string;
      message?: string;
    };
    expect(json.kind).toBe('query-execution');
    expect(json.query).toBe('SELECT ?s WHERE { ?s ?p');
    expect(typeof json.message).toBe('string');
  });

  it('still routes /api/sparql/:id and returns 400 with a structured unknown-ref body for an unknown @id', async () => {
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl') },
        { id: 'beta', glob: join(dirB, '*.ttl') },
      ],
      port: 0,
    });
    const ok = await fetch(
      `http://localhost:${server.port}/api/sparql/alpha?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(ok.status).toBe(200);
    const missing = await fetch(
      `http://localhost:${server.port}/api/sparql/nope?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(missing.status).toBe(400);
    const json = (await missing.json()) as {
      kind?: string;
      ref?: string;
      availableIds?: string[];
    };
    expect(json.kind).toBe('unknown-ref');
    expect(json.ref).toBe('@nope');
    expect(json.availableIds).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('surfaces a first-touch lazy-load SourceError as a 4xx with a structured body (not a 500) when the underlying error is user-input — #290', async () => {
    // A view whose SELECT projection does not match the view's expected
    // shape fails at lazy-load with a `view-validation` SourceError; the
    // pre-#290 path turned every load throw into a blanket 500.
    server = await createServer({
      sources: [
        { id: 'alpha', glob: join(dirA, '*.ttl'), default: true },
        { id: 'bad-view', from: '@alpha', query: 'SELECT ?nope WHERE {}' },
      ],
      port: 0,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql/bad-view?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(resp.status).toBe(400);
    const json = (await resp.json()) as {
      kind?: string;
      message?: string;
    };
    expect(json.kind).toBe('view-validation');
    expect(typeof json.message).toBe('string');
  });

  it('accepts a path id that already carries the `@` address prefix without doubling it', async () => {
    server = await createServer({
      sources: [{ id: 'alpha', glob: join(dirA, '*.ttl') }],
      port: 0,
    });
    const ok = await fetch(
      `http://localhost:${server.port}/api/sparql/${encodeURIComponent(
        '@alpha',
      )}?query=${encodeURIComponent(SELECT_S)}`,
    );
    expect(ok.status).toBe(200);
    const missing = await fetch(
      `http://localhost:${server.port}/api/sparql/${encodeURIComponent(
        '@nope',
      )}?query=${encodeURIComponent(SELECT_S)}`,
    );
    expect(missing.status).toBe(400);
    const json = (await missing.json()) as { ref?: string };
    expect(json.ref).toBe('@nope');
  });
});
