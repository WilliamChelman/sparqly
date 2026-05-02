import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { diffFixture } from './helpers/hash';
import { runCli } from './helpers/run-cli';

describe('sparqly diff — SPARQL source requires a prefilter on each side', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('rejects a SPARQL endpoint on the left when no prefilter is set, without contacting the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));

    const result = await runCli([
      'diff',
      '--quiet',
      endpoint.url,
      diffFixture('domain.ttl'),
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/prefilter/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('rejects a SPARQL endpoint on the right when no prefilter is set, without contacting the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));

    const result = await runCli([
      'diff',
      '--quiet',
      diffFixture('domain.ttl'),
      endpoint.url,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/prefilter/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });
});
