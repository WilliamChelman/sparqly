import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';

const CLEARED_ENV = {
  SPARQLY_CONFIG: undefined,
  SPARQLY_VERBOSE: undefined,
  SPARQLY_QUIET: undefined,
} as const;

const TURTLE =
  '@prefix ex: <http://example.org/> .\n' +
  'ex:alice ex:knows ex:bob .\n' +
  'ex:bob ex:knows ex:carol .\n';

describe('sparqly hash — view-over-disk-backed-glob pass-through (#373, ADR-0047)', () => {
  let projectRoot: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-passthrough-')),
    );
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'data'));
    await writeFile(join(projectRoot, 'data', 'a.ttl'), TURTLE);
  });

  afterEach(async () => {
    if (endpoint) {
      await endpoint.close();
      endpoint = undefined;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('hash @view-over-disk-backed-glob materialises only the scoped result', async () => {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: disk
            glob: data/*.ttl
            storage: disk
          - id: scoped
            from: "@disk"
            query: |
              PREFIX ex: <http://example.org/>
              CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:alice) }
      ` + '\n',
    );

    const result = await runCli(['hash', '--quiet', '@scoped'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^[0-9a-f]{64} {2}/);
    expect(result.stdout).toContain('@scoped');
  });

  it('hash @disk-backed-glob (raw) rejects with the unified raw-pass-through template', async () => {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: disk
            glob: data/*.ttl
            storage: disk
      ` + '\n',
    );

    const result = await runCli(['hash', '@disk'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('disk-backed glob @disk');
    expect(result.stderr).toMatch(/cannot be hashed or diffed directly/i);
    expect(result.stderr).toMatch(/canonicaliz/i);
    expect(result.stderr).toMatch(/wrap it in a `view`/i);
    expect(result.stderr).toMatch(/--query/);
  });

  it('hash <endpoint-url> (raw) rejects with the same unified template, naming the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: JSON.stringify({
        head: { vars: ['s', 'p', 'o'] },
        results: { bindings: [] },
      }),
    }));
    const endpointUrl = endpoint.url;

    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: live
            endpoint: ${endpointUrl}
      ` + '\n',
    );

    const result = await runCli(['hash', '@live'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`endpoint ${endpointUrl}`);
    expect(result.stderr).toMatch(/cannot be hashed or diffed directly/i);
    expect(result.stderr).toMatch(/wrap it in a `view`/i);
    expect(endpoint.requestCount()).toBe(0);
  });
});
