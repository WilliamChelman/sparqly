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

const TURTLE_LEFT =
  '@prefix ex: <http://example.org/> .\n' +
  'ex:alice ex:knows ex:bob .\n' +
  'ex:bob ex:knows ex:carol .\n';

const TURTLE_RIGHT =
  '@prefix ex: <http://example.org/> .\n' +
  'ex:alice ex:knows ex:bob .\n' +
  'ex:bob ex:knows ex:dan .\n';

describe('sparqly diff — view-over-disk-backed-glob pass-through (#374, ADR-0047)', () => {
  let projectRoot: string;
  let endpoint: FakeSparqlEndpoint | undefined;

  beforeEach(async () => {
    projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-diff-passthrough-')),
    );
    await mkdir(join(projectRoot, '.git'));
    await mkdir(join(projectRoot, 'left'));
    await mkdir(join(projectRoot, 'right'));
    await mkdir(join(projectRoot, 'mem'));
    await writeFile(join(projectRoot, 'left', 'a.ttl'), TURTLE_LEFT);
    await writeFile(join(projectRoot, 'right', 'a.ttl'), TURTLE_RIGHT);
    await writeFile(join(projectRoot, 'mem', 'a.ttl'), TURTLE_LEFT);
  });

  afterEach(async () => {
    if (endpoint) {
      await endpoint.close();
      endpoint = undefined;
    }
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('rejects a raw disk-backed glob on the left side with the unified raw-pass-through template', async () => {
    await writeFile(
      join(projectRoot, 'sparqly.config.yaml'),
      dedent`
        sources:
          - id: disk-left
            glob: left/*.ttl
            storage: disk
          - id: mem
            glob: mem/*.ttl
      ` + '\n',
    );

    const result = await runCli(['diff', '@disk-left', '@mem'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(1);
    expect(result.stderr).toContain('disk-backed glob @disk-left');
    expect(result.stderr).toContain('left side');
    expect(result.stderr).toMatch(/cannot be hashed or diffed directly/i);
    expect(result.stderr).toMatch(/--query-file/i);
    expect(result.stderr).toMatch(/--query/);
  });

  it('rejects a raw endpoint on the right side with the unified raw-pass-through template', async () => {
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
          - id: mem
            glob: mem/*.ttl
          - id: live
            endpoint: ${endpointUrl}
      ` + '\n',
    );

    const result = await runCli(['diff', '@mem', '@live'], {
      cwd: projectRoot,
      env: CLEARED_ENV,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(1);
    expect(result.stderr).toContain(`endpoint ${endpointUrl}`);
    expect(result.stderr).toContain('right side');
    expect(result.stderr).toMatch(/cannot be hashed or diffed directly/i);
    expect(result.stderr).toMatch(/--query-file/i);
    expect(endpoint.requestCount()).toBe(0);
  });
});
