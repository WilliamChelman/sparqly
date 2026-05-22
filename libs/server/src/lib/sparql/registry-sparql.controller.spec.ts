import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createServer,
  type CreatedServer,
  type SpawnIndexBuild,
} from '../bootstrap';

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n';
const SELECT_S = 'SELECT ?s WHERE { ?s ?p ?o }';

/**
 * A {@link SpawnIndexBuild} whose build child never finishes on its own — it
 * exits only when SIGTERM'd at server shutdown. Pins a disk-backed glob in
 * `indexing` for the whole test, exercising the `503` path without a real
 * `sparqly index` subprocess.
 */
const stuckIndexBuild: SpawnIndexBuild = () => {
  const exitListeners: Array<(code: number | null) => void> = [];
  return {
    on(event, listener) {
      if (event === 'exit') exitListeners.push(listener);
    },
    kill() {
      for (const listener of exitListeners) listener(null);
    },
  };
};

describe('RegistrySparqlController — /api/sparql alias', () => {
  let dirA: string;
  let dirB: string;
  let cfgDir: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    dirA = await mkdtemp(join(tmpdir(), 'sparqly-alias-a-'));
    dirB = await mkdtemp(join(tmpdir(), 'sparqly-alias-b-'));
    cfgDir = await mkdtemp(join(tmpdir(), 'sparqly-alias-cfg-'));
    await writeFile(join(dirA, 'a.ttl'), SAMPLE_A);
    await writeFile(join(dirB, 'b.ttl'), SAMPLE_B);
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
    await rm(cfgDir, { recursive: true, force: true });
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

  it('returns 503 with a structured indexing body for the first request to a not-yet-indexed disk-backed glob (ADR-0041 / #340)', async () => {
    server = await createServer({
      sources: [{ id: 'big', glob: join(dirA, '*.ttl'), storage: 'disk' }],
      port: 0,
      configDir: cfgDir,
      spawnIndexBuild: stuckIndexBuild,
    });
    const resp = await fetch(
      `http://localhost:${server.port}/api/sparql/big?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(resp.status).toBe(503);
    const json = (await resp.json()) as {
      kind?: string;
      source?: string;
      message?: string;
    };
    expect(json.kind).toBe('indexing');
    expect(json.source).toBe('big');
    expect(typeof json.message).toBe('string');
  });

  it('answers other registered sources normally while a disk-backed glob is still indexing', async () => {
    server = await createServer({
      sources: [
        { id: 'big', glob: join(dirA, '*.ttl'), storage: 'disk' },
        { id: 'small', glob: join(dirB, '*.ttl') },
      ],
      port: 0,
      configDir: cfgDir,
      spawnIndexBuild: stuckIndexBuild,
    });
    // First touch of the disk-backed glob kicks its background build.
    const indexing = await fetch(
      `http://localhost:${server.port}/api/sparql/big?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(indexing.status).toBe(503);

    // The in-memory source stays fully available throughout the build.
    const ok = await fetch(
      `http://localhost:${server.port}/api/sparql/small?query=${encodeURIComponent(
        SELECT_S,
      )}`,
    );
    expect(ok.status).toBe(200);
    const json = (await ok.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/c',
    ]);
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
