import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { startServe, type ServeHandle } from './helpers/serve';

describe('sparqly serve — Single-source mode (issue #142)', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-single-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('boots in Single-source mode when given a positional inline glob (`sparqly serve foo.ttl`)', async () => {
    const ttlPath = join(dir, 'foo.ttl');
    await writeFile(
      ttlPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );

    handle = await startServe([ttlPath]);

    // Single endpoint at /api/sparql (no @id segment) returns rows.
    const res = await fetch(
      `${handle.baseUrl}/api/sparql?query=${encodeURIComponent(
        'SELECT ?s WHERE { ?s ?p ?o }',
      )}`,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings).toHaveLength(1);
    expect(json.results.bindings[0].s.value).toBe('http://example.org/a');

    // Registry-mode-style /api/sparql/<id> path is NOT mounted in single-source mode.
    const registryShaped = await fetch(
      `${handle.baseUrl}/api/sparql/foo?query=${encodeURIComponent(
        'ASK { ?s ?p ?o }',
      )}`,
    );
    expect(registryShaped.status).toBe(404);
  });

  it('exposes /api/sources with exactly one entry in Single-source mode', async () => {
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

    handle = await startServe(['--config', configPath, '--source', '@alpha']);

    const res = await fetch(`${handle.baseUrl}/api/sources`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      sources: Array<{ id: string; kind: string; default?: boolean }>;
    };
    expect(json.sources).toHaveLength(1);
    expect(json.sources[0]).toMatchObject({ id: 'alpha', kind: 'glob' });

    // /api/diff is intentionally not mounted in single-source mode.
    const diffRes = await fetch(`${handle.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ left: '@alpha', right: '@alpha' }),
    });
    expect(diffRes.status).toBe(404);
  });

  it('rejects --source @nonexistent at boot with a clear error listing available `@id`s', async () => {
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

    const result = await runCli([
      'serve',
      '--config',
      configPath,
      '--source',
      '@nonexistent',
    ]);
    expect(result.exitCode).not.toBe(0);
    const out = result.stderr + result.stdout;
    expect(out).toMatch(/@nonexistent/);
    expect(out).toMatch(/@alpha/);
  });
});
