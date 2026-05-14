import { DataFactory, Store } from 'n3';
import { afterEach, describe, expect, it } from 'vitest';
import { describeEndpointResult } from './describe-endpoint';
import type { ParsedEndpointSource } from '../sources';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from '../test/fake-sparql-endpoint';
import { startStoreBackedSparqlEndpoint } from '../test/store-backed-sparql-endpoint';
import { ttl } from '../test/turtle';

const { namedNode } = DataFactory;

describe('describeEndpointResult (Result-typed primary impl)', () => {
  let ep: FakeSparqlEndpoint | undefined;

  afterEach(async () => {
    if (ep) await ep.close();
    ep = undefined;
  });

  it('returns ok with the same payload describeEndpoint resolves to on success', async () => {
    const { quads } = ttl`
      @prefix ex: <http://example.org/> .
      ex:alice ex:knows ex:bob .
    `;
    const store = new Store();
    store.addQuads(quads as never);
    ep = await startStoreBackedSparqlEndpoint(store);
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: ep.url };

    const result = await describeEndpointResult({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.quads).toHaveLength(1);
      expect(result.value.truncated).toBe(false);
    }
  });

  it('returns err with a structured EndpointDescribeError when both edge directions fail', async () => {
    const fake = await startFakeSparqlEndpoint(() => ({ status: 500, body: 'down' }));
    ep = fake;
    const endpoint: ParsedEndpointSource = { kind: 'endpoint', endpoint: fake.url };
    const result = await describeEndpointResult({
      endpoint,
      seed: namedNode('http://example.org/alice'),
      perSourceLimit: 10000,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('endpoint-describe');
      expect(result.error.endpoint).toBe(fake.url);
      expect(result.error.message).toMatch(/500|HTTP/);
    }
  });
});
