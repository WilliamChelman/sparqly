import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { diffFixture } from './helpers/hash';
import { runCli } from './helpers/run-cli';

// Pass-through forwards the CONSTRUCT verbatim; the fake endpoint must
// respond with turtle (the wire format for CONSTRUCT). The fixture is the
// post-filter slice — i.e. what a real endpoint would return for the
// scoping query below.
const KEPT_TURTLE =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:v1 .\n';

const SCOPE_QUERY =
  'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';

describe('sparqly diff — symmetric --query / --query-file', () => {
  let leftEndpoint: FakeSparqlEndpoint | undefined;
  let rightEndpoint: FakeSparqlEndpoint | undefined;
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-anon-view-'));
  });

  afterEach(async () => {
    if (leftEndpoint) await leftEndpoint.close();
    leftEndpoint = undefined;
    if (rightEndpoint) await rightEndpoint.close();
    rightEndpoint = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('symmetric --query: scopes both sides identically; no diff when scoped slices match', async () => {
    leftEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    rightEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      leftEndpoint.url,
      rightEndpoint.url,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(leftEndpoint.requestCount()).toBeGreaterThan(0);
    expect(rightEndpoint.requestCount()).toBeGreaterThan(0);
  });

  it('--left-query and --right-query independently scope each side; equal scoped slices produce no diff', async () => {
    leftEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle',
      body: KEPT_TURTLE,
    }));
    // Pass-through delegates filtering to the endpoint, so both sides return
    // the same kept slice — the matching post-filter set is what equates them.
    rightEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle',
      body: KEPT_TURTLE,
    }));

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      SCOPE_QUERY,
      '--right-query',
      SCOPE_QUERY,
      leftEndpoint.url,
      rightEndpoint.url,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(leftEndpoint.requestCount()).toBeGreaterThan(0);
    expect(rightEndpoint.requestCount()).toBeGreaterThan(0);
  });

  it('--left-query-file and --right-query-file behave equivalently to inline forms', async () => {
    leftEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    rightEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    const leftQ = join(scratch, 'left.rq');
    const rightQ = join(scratch, 'right.rq');
    await writeFile(leftQ, SCOPE_QUERY);
    await writeFile(rightQ, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query-file',
      leftQ,
      '--right-query-file',
      rightQ,
      leftEndpoint.url,
      rightEndpoint.url,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
  });

  it('symmetric --query-file: behaves equivalently to --query', async () => {
    leftEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    rightEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--query-file',
      queryPath,
      leftEndpoint.url,
      rightEndpoint.url,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
  });
});

describe('sparqly diff — inline scoping query: error matrix', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-anon-view-err-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('symmetric --query and --query-file are mutually exclusive', async () => {
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      '--query-file',
      queryPath,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--query.*--query-file|mutually exclusive/i);
  });

  it('--left-query and --left-query-file are mutually exclusive', async () => {
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      SCOPE_QUERY,
      '--left-query-file',
      queryPath,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /--left-query.*--left-query-file|mutually exclusive/i,
    );
  });

  it('--right-query and --right-query-file are mutually exclusive', async () => {
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--right-query',
      SCOPE_QUERY,
      '--right-query-file',
      queryPath,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /--right-query.*--right-query-file|mutually exclusive/i,
    );
  });

  it('symmetric --query conflicts with --left-query on the left side', async () => {
    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      '--left-query',
      SCOPE_QUERY,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--query.*--left-query|mutually exclusive/i);
  });

  it('symmetric --query conflicts with --right-query-file on the right side', async () => {
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      '--right-query-file',
      queryPath,
      diffFixture('domain.ttl'),
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /--query.*--right-query-file|mutually exclusive/i,
    );
  });

  it('rejects more than one source on the left when --left-query is provided (via config)', async () => {
    const configPath = join(scratch, 'multi-left.yaml');
    await writeFile(
      configPath,
      [
        'left:',
        `  - "${diffFixture('domain.ttl')}"`,
        `  - "${diffFixture('parts/*.ttl')}"`,
        `right: "${diffFixture('domain.ttl')}"`,
      ].join('\n') + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--config',
      configPath,
      '--left-query',
      SCOPE_QUERY,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/exactly one source|single source|one source/i);
  });

  it('accepts a SPARQL endpoint on the left when --left-query is provided', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: KEPT_TURTLE,
    }));
    try {
      const ttlPath = join(scratch, 'kept.ttl');
      await writeFile(
        ttlPath,
        [
          '@prefix ex: <http://example.org/> .',
          'ex:keep ex:p ex:v1 .',
        ].join('\n') + '\n',
      );

      const result = await runCli([
        'diff',
        '--quiet',
        '--left-query',
        SCOPE_QUERY,
        endpoint.url,
        ttlPath,
      ]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(endpoint.requestCount()).toBeGreaterThan(0);
    } finally {
      await endpoint.close();
    }
  });

  it('still rejects a raw SPARQL endpoint on the right when no scoping query covers that side', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));
    try {
      const result = await runCli([
        'diff',
        '--quiet',
        '--left-query',
        SCOPE_QUERY,
        diffFixture('domain.ttl'),
        endpoint.url,
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/view/i);
      expect(result.stderr).toContain(endpoint.url);
      expect(endpoint.requestCount()).toBe(0);
    } finally {
      await endpoint.close();
    }
  });

  it('rejects more than one source on either side when symmetric --query is provided (via config)', async () => {
    const configPath = join(scratch, 'multi-sym.yaml');
    await writeFile(
      configPath,
      [
        'left:',
        `  - "${diffFixture('domain.ttl')}"`,
        `  - "${diffFixture('parts/*.ttl')}"`,
        `right: "${diffFixture('domain.ttl')}"`,
      ].join('\n') + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--config',
      configPath,
      '--query',
      SCOPE_QUERY,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/exactly one source|single source|one source/i);
  });
});
