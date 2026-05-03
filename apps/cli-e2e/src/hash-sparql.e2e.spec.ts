import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { hashFixture, leadingHash } from './helpers/hash';
import { runCli } from './helpers/run-cli';

// Pass-through forwards the CONSTRUCT verbatim; the fake endpoint must
// respond with turtle (the wire format for CONSTRUCT). The fixture is the
// post-filter slice — i.e. what a real endpoint would return for the
// scoping query below.
const KEPT_TURTLE =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:v1 .\n';

const SCOPE_QUERY =
  'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';

describe('sparqly hash — raw SPARQL endpoint sources are rejected', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('rejects a raw SPARQL endpoint as primary source, without contacting the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));

    const result = await runCli(['hash', '--quiet', endpoint.url]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/view/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('rejects a raw SPARQL endpoint on the --compare-with side, without contacting the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));
    const primary = hashFixture('domain.ttl');

    const result = await runCli([
      'hash',
      '--quiet',
      primary,
      '--compare-with',
      endpoint.url,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/view/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });
});

describe('sparqly hash — inline scoping query (anonymous view)', () => {
  let endpoint: FakeSparqlEndpoint | undefined;
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-anon-view-'));
  });

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('--query: hashes a scoped slice of a SPARQL endpoint, equal to hashing the same slice from a turtle file', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle',
      body: KEPT_TURTLE,
    }));

    const ttlPath = join(scratch, 'kept.ttl');
    await writeFile(
      ttlPath,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
      ].join('\n') + '\n',
    );

    const viaEndpoint = await runCli([
      'hash',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      endpoint.url,
    ]);
    const viaFile = await runCli(['hash', '--quiet', ttlPath]);

    expect(viaEndpoint.exitCode, viaEndpoint.stderr).toBe(0);
    expect(viaFile.exitCode, viaFile.stderr).toBe(0);
    expect(leadingHash(viaEndpoint.stdout)).toBe(leadingHash(viaFile.stdout));
    expect(endpoint.requestCount()).toBeGreaterThan(0);
  });

  it('--query-file: behaves equivalently to --query', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle',
      body: KEPT_TURTLE,
    }));
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const ttlPath = join(scratch, 'kept.ttl');
    await writeFile(
      ttlPath,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
      ].join('\n') + '\n',
    );

    const viaEndpoint = await runCli([
      'hash',
      '--quiet',
      '--query-file',
      queryPath,
      endpoint.url,
    ]);
    const viaFile = await runCli(['hash', '--quiet', ttlPath]);

    expect(viaEndpoint.exitCode, viaEndpoint.stderr).toBe(0);
    expect(viaFile.exitCode, viaFile.stderr).toBe(0);
    expect(leadingHash(viaEndpoint.stdout)).toBe(leadingHash(viaFile.stdout));
  });

  it('--query and --query-file are mutually exclusive', async () => {
    const queryPath = join(scratch, 'scope.rq');
    await writeFile(queryPath, SCOPE_QUERY);

    const result = await runCli([
      'hash',
      '--quiet',
      '--query',
      SCOPE_QUERY,
      '--query-file',
      queryPath,
      hashFixture('domain.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--query.*--query-file|mutually exclusive/i);
  });

});

describe('sparqly hash --compare-with — per-side inline scoping', () => {
  let primaryEndpoint: FakeSparqlEndpoint | undefined;
  let secondaryEndpoint: FakeSparqlEndpoint | undefined;
  let scratch: string;

  // Pass-through delegates filtering to the endpoint, so the fixtures are
  // the post-filter slices — both sides return the same kept triple.
  const PRIMARY_TURTLE =
    '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:v1 .\n';
  const SECONDARY_TURTLE =
    '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:v1 .\n';

  const PRIMARY_SCOPE_QUERY =
    'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';
  // The compare-with side has its own "extra" noise (different from primary's "drop"),
  // so a working per-side scope must keep only ex:keep to match.
  const SECONDARY_SCOPE_QUERY =
    'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }';

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-compare-anon-view-'));
  });

  afterEach(async () => {
    if (primaryEndpoint) await primaryEndpoint.close();
    primaryEndpoint = undefined;
    if (secondaryEndpoint) await secondaryEndpoint.close();
    secondaryEndpoint = undefined;
    await rm(scratch, { recursive: true, force: true });
  });

  it('--query and --compare-with-query scope each side independently and match on the kept slice', async () => {
    primaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: PRIMARY_TURTLE,
    }));
    secondaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: SECONDARY_TURTLE,
    }));

    const result = await runCli([
      'hash',
      '--quiet',
      '--query',
      PRIMARY_SCOPE_QUERY,
      primaryEndpoint.url,
      '--compare-with',
      secondaryEndpoint.url,
      '--compare-with-query',
      SECONDARY_SCOPE_QUERY,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^match: [0-9a-f]{64}\n$/);
    expect(primaryEndpoint.requestCount()).toBeGreaterThan(0);
    expect(secondaryEndpoint.requestCount()).toBeGreaterThan(0);
  });

  it('--compare-with-query-file behaves equivalently to --compare-with-query', async () => {
    primaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: PRIMARY_TURTLE,
    }));
    secondaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: SECONDARY_TURTLE,
    }));

    const compareQueryPath = join(scratch, 'compare-scope.rq');
    await writeFile(compareQueryPath, SECONDARY_SCOPE_QUERY);

    const result = await runCli([
      'hash',
      '--quiet',
      '--query',
      PRIMARY_SCOPE_QUERY,
      primaryEndpoint.url,
      '--compare-with',
      secondaryEndpoint.url,
      '--compare-with-query-file',
      compareQueryPath,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^match: [0-9a-f]{64}\n$/);
  });

  it('--compare-with-query and --compare-with-query-file are mutually exclusive', async () => {
    const compareQueryPath = join(scratch, 'compare-scope.rq');
    await writeFile(compareQueryPath, SECONDARY_SCOPE_QUERY);

    const result = await runCli([
      'hash',
      '--quiet',
      hashFixture('domain.ttl'),
      '--compare-with',
      hashFixture('domain.ttl'),
      '--compare-with-query',
      SECONDARY_SCOPE_QUERY,
      '--compare-with-query-file',
      compareQueryPath,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /--compare-with-query.*--compare-with-query-file|mutually exclusive/i,
    );
  });

  it('rejects --compare-with-query without --compare-with', async () => {
    const result = await runCli([
      'hash',
      '--quiet',
      hashFixture('domain.ttl'),
      '--compare-with-query',
      SECONDARY_SCOPE_QUERY,
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--compare-with/);
  });

  it('accepts a SPARQL endpoint on the --compare-with side when --compare-with-query is provided', async () => {
    primaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: PRIMARY_TURTLE,
    }));
    secondaryEndpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'text/turtle', body: SECONDARY_TURTLE,
    }));

    const result = await runCli([
      'hash',
      '--quiet',
      '--query',
      PRIMARY_SCOPE_QUERY,
      primaryEndpoint.url,
      '--compare-with',
      secondaryEndpoint.url,
      '--compare-with-query',
      SECONDARY_SCOPE_QUERY,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(secondaryEndpoint.requestCount()).toBeGreaterThan(0);
  });
});
