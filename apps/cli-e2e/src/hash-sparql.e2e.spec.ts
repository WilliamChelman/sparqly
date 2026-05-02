import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { hashFixture } from './helpers/hash';
import { runCli } from './helpers/run-cli';

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
