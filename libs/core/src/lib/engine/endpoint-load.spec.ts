import { describe, expect, it } from 'vitest';
import {
  loadEndpointToStore,
  loadEndpointToStoreResult,
} from './endpoint-load';
import { startFakeSparqlEndpoint } from '../test/fake-sparql-endpoint';

describe('loadEndpointToStoreResult', () => {
  it('returns Result.ok with the materialized triples for a reachable endpoint', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      contentType: 'application/sparql-results+json',
      body: JSON.stringify({
        head: { vars: ['s', 'p', 'o'] },
        results: {
          bindings: [
            {
              s: { type: 'uri', value: 'http://example.org/a' },
              p: { type: 'uri', value: 'http://example.org/p' },
              o: { type: 'uri', value: 'http://example.org/b' },
            },
          ],
        },
      }),
    }));
    try {
      const result = await loadEndpointToStoreResult({
        kind: 'endpoint',
        endpoint: endpoint.url,
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) throw new Error('unreachable');
      expect(result.value.size).toBe(1);
    } finally {
      await endpoint.close();
    }
  });

  it('returns Result.err with an endpoint-fetch variant naming the endpoint when the remote 500s', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      status: 500,
      body: 'boom',
    }));
    try {
      const result = await loadEndpointToStoreResult({
        kind: 'endpoint',
        endpoint: endpoint.url,
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) throw new Error('unreachable');
      expect(result.error.kind).toBe('endpoint-fetch');
      if (result.error.kind !== 'endpoint-fetch') throw new Error('unreachable');
      expect(result.error.endpoint).toBe(endpoint.url);
      expect(result.error.message.length).toBeGreaterThan(0);
    } finally {
      await endpoint.close();
    }
  });
});

describe('loadEndpointToStore (legacy adapter)', () => {
  it('still throws with the legacy prefixed message for 5xx responses', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      status: 500,
      body: 'boom',
    }));
    try {
      await expect(
        loadEndpointToStore({ kind: 'endpoint', endpoint: endpoint.url }),
      ).rejects.toThrow(new RegExp(`endpoint ${endpoint.url}`));
    } finally {
      await endpoint.close();
    }
  });
});
