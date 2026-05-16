import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

describe('sparqly serve — Registry mode default (issue #141)', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-registry-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('exposes /api/config and /api/sparql/<id> for every non-reference source', async () => {
    const alphaPath = join(dir, 'alpha.ttl');
    const betaPath = join(dir, 'beta.ttl');
    await writeFile(
      alphaPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    await writeFile(
      betaPath,
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n',
    );

    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${alphaPath}"
          - id: beta
            default: true
            glob: "${betaPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const sourcesRes = await fetch(`${handle.baseUrl}/api/config`);
    expect(sourcesRes.status).toBe(200);
    const sourcesJson = (await sourcesRes.json()) as {
      sources: Array<{ id: string; kind: string; default?: boolean }>;
    };
    const ids = sourcesJson.sources.map((s) => s.id).sort();
    expect(ids).toEqual(['alpha', 'beta']);
    const beta = sourcesJson.sources.find((s) => s.id === 'beta');
    expect(beta?.default).toBe(true);

    for (const id of ids) {
      const res = await fetch(
        `${handle.baseUrl}/api/sparql/${id}?query=${encodeURIComponent(
          'SELECT ?s WHERE { ?s ?p ?o }',
        )}`,
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      expect(json.results.bindings).toHaveLength(1);
      const expected =
        id === 'alpha' ? 'http://example.org/a' : 'http://example.org/c';
      expect(json.results.bindings[0].s.value).toBe(expected);
    }
  });

  it('boots even when a pass-through endpoint source has an unreachable remote', async () => {
    const alphaPath = join(dir, 'alpha.ttl');
    await writeFile(
      alphaPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );

    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${alphaPath}"
          - id: dead
            endpoint: "http://127.0.0.1:1/sparql"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const sources = (await (
      await fetch(`${handle.baseUrl}/api/config`)
    ).json()) as { sources: Array<{ id: string }> };
    expect(sources.sources.map((s) => s.id).sort()).toEqual(['alpha', 'dead']);

    // Materialized side serves SPARQL fine, even though `dead` is unreachable.
    const res = await fetch(
      `${handle.baseUrl}/api/sparql/alpha?query=${encodeURIComponent(
        'ASK { ?s ?p ?o }',
      )}`,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 unknown-ref on /api/sparql/<unknown-id>', async () => {
    const alphaPath = join(dir, 'alpha.ttl');
    await writeFile(
      alphaPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${alphaPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath]);

    const res = await fetch(
      `${handle.baseUrl}/api/sparql/nope?query=${encodeURIComponent(
        'ASK { ?s ?p ?o }',
      )}`,
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { kind?: string; ref?: string };
    expect(json.kind).toBe('unknown-ref');
    expect(json.ref).toBe('@nope');
  });

  it('logs per-@id load timing on first request (ADR-0031 lazy materialization)', async () => {
    const alphaPath = join(dir, 'alpha.ttl');
    const betaPath = join(dir, 'beta.ttl');
    await writeFile(
      alphaPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );
    await writeFile(
      betaPath,
      '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n',
    );
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${alphaPath}"
          - id: beta
            glob: "${betaPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath, '--verbose']);

    // Under lazy materialization, no source is loaded until first request.
    expect(handle.stderr()).not.toMatch(/DEBUG \[sparqly\] source-loaded/);

    for (const id of ['alpha', 'beta']) {
      const res = await fetch(
        `${handle.baseUrl}/api/sparql/${id}?query=${encodeURIComponent(
          'ASK { ?s ?p ?o }',
        )}`,
      );
      expect(res.status).toBe(200);
    }

    const stderr = handle.stderr();
    expect(stderr).toMatch(
      /DEBUG \[sparqly\] source-loaded .*\bsource=alpha\b.*\bkind=glob\b.*\bms=\d+\b/,
    );
    expect(stderr).toMatch(
      /DEBUG \[sparqly\] source-loaded .*\bsource=beta\b.*\bkind=glob\b.*\bms=\d+\b/,
    );
  });
});
