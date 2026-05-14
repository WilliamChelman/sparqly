import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { diffFixture } from './helpers/hash';
import { runCli } from './helpers/run-cli';

describe('sparqly diff — raw SPARQL endpoint sources are rejected on either side', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('rejects a raw SPARQL endpoint on the left, without contacting the endpoint', async () => {
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

    expect(result.exitCode).toBe(14);
    expect(result.stderr).toMatch(/view/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });

  it('rejects a raw SPARQL endpoint on the right, without contacting the endpoint', async () => {
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

    expect(result.exitCode).toBe(14);
    expect(result.stderr).toMatch(/view/i);
    expect(result.stderr).toContain(endpoint.url);
    expect(endpoint.requestCount()).toBe(0);
  });
});
