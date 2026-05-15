import dedent from 'dedent';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('view-pin chain-bottom errors (ADR-0029, issue #277)', () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-pinned-errors-'));
  });

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it('errors when `hash @view --at v1.2.0` chain bottoms on an endpoint, naming the offending id', async () => {
    const configPath = join(scratch, 'view-endpoint.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: remote
            endpoint: "http://localhost:65535/sparql"
          - id: mid
            from: "@remote"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
          - id: outer
            from: "@mid"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    const result = await runCli(
      ['hash', '@outer', '--at', 'v1.2.0', '--config', configPath, '--quiet'],
      { cwd: scratch },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/@outer/);
    expect(result.stderr).toMatch(/@remote/);
    expect(result.stderr).toMatch(/endpoint/);
  });

  it('errors when `hash @view --at v1.2.0` chain bottoms on an empty source, naming the offending id', async () => {
    const configPath = join(scratch, 'view-empty.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: composer
            empty: true
          - id: composed
            from: "@composer"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    const result = await runCli(
      ['hash', '@composed', '--at', 'v1.2.0', '--config', configPath, '--quiet'],
      { cwd: scratch },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/@composed/);
    expect(result.stderr).toMatch(/@composer/);
    expect(result.stderr).toMatch(/empty/);
  });

  it('errors when `view.from: @<view-id>:<ref>` chain bottoms on an endpoint, before any I/O', async () => {
    const configPath = join(scratch, 'view-of-endpoint-chain.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: remote
            endpoint: "http://localhost:65535/sparql"
          - id: inner
            from: "@remote"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
          - id: outer
            from: "@inner:v1.2.0"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    const result = await runCli(
      ['query', '@outer', '--config', configPath, '--quiet', '-q', 'SELECT ?s WHERE { ?s ?p ?o }'],
      { cwd: scratch },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/@outer/);
    expect(result.stderr).toMatch(/@remote/);
    expect(result.stderr).toMatch(/endpoint/);
  });
});
