import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { startServe, type ServeHandle } from './helpers/serve';

const SELECT_S = encodeURIComponent('SELECT ?s WHERE { ?s ?p ?o }');

describe('sparqly serve — --source as a scope filter (ADR-0016 / #197)', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-serve-scope-'));
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('positional inline glob answers on both /api/sparql and /api/sparql/default; / serves the playground', async () => {
    const ttlPath = join(dir, 'foo.ttl');
    await writeFile(
      ttlPath,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
    );

    handle = await startServe([ttlPath]);

    for (const path of ['/api/sparql', '/api/sparql/default']) {
      const res = await fetch(`${handle.baseUrl}${path}?query=${SELECT_S}`);
      expect(res.status, path).toBe(200);
      const json = (await res.json()) as {
        results: { bindings: Array<{ s: { value: string } }> };
      };
      expect(json.results.bindings.map((b) => b.s.value)).toEqual([
        'http://example.org/a',
      ]);
    }

    const home = await fetch(`${handle.baseUrl}/`, {
      headers: { accept: 'text/html' },
    });
    expect(home.status).toBe(200);
    expect((await home.text()).toLowerCase()).toContain('<html');
  });

  it('--source @x against a multi-source config serves only @x; filtered ids 400 unknown-ref; /api/config lists only the served set', async () => {
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

    const served = await fetch(
      `${handle.baseUrl}/api/sparql/alpha?query=${SELECT_S}`,
    );
    expect(served.status).toBe(200);

    const filtered = await fetch(
      `${handle.baseUrl}/api/sparql/beta?query=${SELECT_S}`,
    );
    expect(filtered.status).toBe(400);
    const filteredJson = (await filtered.json()) as {
      kind?: string;
      ref?: string;
    };
    expect(filteredJson.kind).toBe('unknown-ref');
    expect(filteredJson.ref).toBe('@beta');

    const cfg = await fetch(`${handle.baseUrl}/api/config`);
    const json = (await cfg.json()) as {
      sources: Array<{ id: string; kind: string; default?: boolean }>;
    };
    expect(json.sources).toHaveLength(1);
    expect(json.sources[0]).toMatchObject({ id: 'alpha', kind: 'glob' });

    // /api/describe with no `source` resolves the served set's sole entry
    // (alpha) and returns the flattened single-source shape (ADR-0052).
    const describeRes = await fetch(`${handle.baseUrl}/api/describe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iri: 'http://example.org/a' }),
    });
    expect(describeRes.status).toBe(200);
    const describeJson = (await describeRes.json()) as {
      iri: string;
      total: number;
      truncated: boolean;
    };
    expect(describeJson).not.toHaveProperty('perSource');
    expect(typeof describeJson.total).toBe('number');
    expect(typeof describeJson.truncated).toBe('boolean');

    // /api/diff cannot name a filtered-out @id; per ADR-0024 / #248 this is a
    // transport-level 400 carrying a structured TargetWrappedError body whose
    // nested target is `unknown-ref` (wrap-don't-duplicate).
    const diffRes = await fetch(`${handle.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ left: '@beta', right: '@alpha' }),
    });
    expect(diffRes.status).toBe(400);
    const diffJson = (await diffRes.json()) as {
      kind?: string;
      side?: string;
      target?: { kind?: string; ref?: string; availableIds?: string[] };
    };
    expect(diffJson.kind).toBe('target');
    expect(diffJson.side).toBe('left');
    expect(diffJson.target?.kind).toBe('unknown-ref');
    expect(diffJson.target?.ref).toBe('@beta');
    const available = diffJson.target?.availableIds ?? [];
    expect(available).toContain('alpha');
    expect(available).not.toContain('beta');
  });

  it('--source @nonexistent fails at boot with an error listing the available @ids', async () => {
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

  it('an inline positional glob alongside a configured `sources:` serves only the glob as @default; configured sources stay resolvable via `from:`', async () => {
    const configuredPath = join(dir, 'configured.ttl');
    const adhocPath = join(dir, 'adhoc.ttl');
    await writeFile(
      configuredPath,
      '@prefix ex: <http://example.org/> . ex:configured ex:p ex:c .\n',
    );
    await writeFile(
      adhocPath,
      '@prefix ex: <http://example.org/> . ex:adhoc ex:p ex:a .\n',
    );
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: configured
            glob: "${configuredPath}"
      ` + '\n',
    );

    handle = await startServe(['--config', configPath, adhocPath]);

    // Served set is just the synthesized @default (the inline glob).
    const def = await fetch(
      `${handle.baseUrl}/api/sparql/default?query=${SELECT_S}`,
    );
    expect(def.status).toBe(200);
    const json = (await def.json()) as {
      results: { bindings: Array<{ s: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.s.value)).toEqual([
      'http://example.org/adhoc',
    ]);

    // The configured source is no longer routed/listed.
    const configured = await fetch(
      `${handle.baseUrl}/api/sparql/configured?query=${SELECT_S}`,
    );
    expect(configured.status).toBe(400);
    const configuredJson = (await configured.json()) as {
      kind?: string;
      ref?: string;
    };
    expect(configuredJson.kind).toBe('unknown-ref');
    expect(configuredJson.ref).toBe('@configured');
    const cfg = await fetch(`${handle.baseUrl}/api/config`);
    const cfgJson = (await cfg.json()) as { sources: Array<{ id: string }> };
    expect(cfgJson.sources.map((s) => s.id)).toEqual(['default']);
  });
});
