import { afterEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

describe('sparqly format — rejects SPARQL endpoint sources', () => {
  let endpoint: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (endpoint) await endpoint.close();
    endpoint = undefined;
  });

  it('rejects a SPARQL endpoint as a positional source without contacting the endpoint', async () => {
    endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: '{}',
    }));

    const result = await runCli(['format', '--quiet', endpoint.url]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(endpoint.url);
    expect(result.stderr).toMatch(
      /sparqly query --format=turtle.*sparqly format/,
    );
    expect(endpoint.requestCount()).toBe(0);
  });
});
