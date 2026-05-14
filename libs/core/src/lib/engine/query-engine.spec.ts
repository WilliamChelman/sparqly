import { Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { QueryEngine } from './query-engine';
import { ttl } from '../test/turtle';
import { startFakeSparqlEndpoint } from '../test/fake-sparql-endpoint';
import { recordingLogger, type RecordedLog } from '../test/recording-logger';

function exampleStore(): Store {
  const { quads } = ttl`
    @prefix ex: <http://example.org/> .
    ex:a ex:p ex:b .
  `;
  const store = new Store();
  store.addQuads(quads);
  return store;
}

describe('QueryEngine.execute', () => {
  it('returns SPARQL JSON results for a SELECT query by default', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute(
      'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
    );

    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/sparql-results+json');
    const parsed = JSON.parse(result.body);
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings).toHaveLength(1);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(parsed.results.bindings[0].o.value).toBe('http://example.org/b');
  });

  it('rejects with a clear error on an invalid query', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(engine.execute('SELECT ?s WHERE { ?s ?p')).rejects.toThrow();
  });

  it('returns SPARQL JSON results for an ASK query by default', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute(
      'ASK WHERE { ?s <http://example.org/p> ?o }',
    );

    expect(result.format).toBe('json');
    expect(result.contentType).toBe('application/sparql-results+json');
    const parsed = JSON.parse(result.body);
    expect(parsed.boolean).toBe(true);
  });

  it('returns Turtle for a CONSTRUCT query by default', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute(
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    );

    expect(result.format).toBe('turtle');
    expect(result.contentType).toBe('text/turtle');
    expect(result.body).toContain('http://example.org/a');
    expect(result.body).toContain('http://example.org/p');
    expect(result.body).toContain('http://example.org/b');
  });

  it('returns Turtle for a DESCRIBE query by default', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute('DESCRIBE <http://example.org/a>');

    expect(result.format).toBe('turtle');
    expect(result.contentType).toBe('text/turtle');
    expect(result.body).toContain('http://example.org/a');
  });

  it('honours --format=json override on SELECT', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute(
      'SELECT ?s WHERE { ?s ?p ?o }',
      { format: 'json' },
    );

    expect(result.format).toBe('json');
    JSON.parse(result.body);
  });

  it('honours --format=turtle override on CONSTRUCT', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.execute(
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      { format: 'turtle' },
    );

    expect(result.format).toBe('turtle');
    expect(result.body).toContain('http://example.org/a');
  });

  it('rejects --format=turtle on a SELECT query with a clear error', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(
      engine.execute('SELECT ?s WHERE { ?s ?p ?o }', { format: 'turtle' }),
    ).rejects.toThrow(/turtle.*SELECT|SELECT.*turtle|incompatible/i);
  });

  it('rejects --format=turtle on an ASK query with a clear error', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(
      engine.execute('ASK WHERE { ?s ?p ?o }', { format: 'turtle' }),
    ).rejects.toThrow(/turtle|incompatible/i);
  });

  it('rejects --format=json on a CONSTRUCT query with a clear error', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(
      engine.execute('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', {
        format: 'json',
      }),
    ).rejects.toThrow(/json|incompatible/i);
  });

  it('rejects --format=json on a DESCRIBE query with a clear error', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(
      engine.execute('DESCRIBE <http://example.org/a>', { format: 'json' }),
    ).rejects.toThrow(/json|incompatible/i);
  });

  describe('immutability guard', () => {
    const mutatingQueries: ReadonlyArray<{ verb: string; query: string }> = [
      {
        verb: 'INSERT DATA',
        query:
          'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
      },
      {
        verb: 'DELETE DATA',
        query:
          'DELETE DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
      },
      {
        verb: 'INSERT WHERE',
        query:
          'INSERT { ?s <http://example.org/q> ?o } WHERE { ?s <http://example.org/p> ?o }',
      },
      {
        verb: 'DELETE WHERE',
        query:
          'DELETE { ?s <http://example.org/p> ?o } WHERE { ?s <http://example.org/p> ?o }',
      },
      {
        verb: 'LOAD',
        query: 'LOAD <http://example.org/data.ttl>',
      },
    ];

    for (const { verb, query } of mutatingQueries) {
      it(`rejects ${verb} by default with a message referencing the opt-in flags`, async () => {
        const engine = new QueryEngine(exampleStore());
        await expect(engine.execute(query)).rejects.toThrow(
          /Mutating queries.*--mutable.*--immutable=false/,
        );
      });

      it(`bypasses the guard for ${verb} when mutable=true (execution-not-implemented error)`, async () => {
        const engine = new QueryEngine(exampleStore());
        await expect(
          engine.execute(query, { mutable: true }),
        ).rejects.toThrow(/not yet implemented/i);
      });
    }

    it.each([
      { verb: 'SELECT', query: 'SELECT ?s WHERE { ?s ?p ?o }' },
      { verb: 'ASK', query: 'ASK WHERE { ?s ?p ?o }' },
      { verb: 'CONSTRUCT', query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' },
      { verb: 'DESCRIBE', query: 'DESCRIBE <http://example.org/a>' },
    ])(
      '$verb passes the guard regardless of the mutable flag',
      async ({ query }) => {
        const engine = new QueryEngine(exampleStore());
        await expect(engine.execute(query)).resolves.toBeDefined();
        await expect(
          engine.execute(query, { mutable: true }),
        ).resolves.toBeDefined();
      },
    );
  });
});

describe('QueryEngine — query event logging', () => {
  function queryEvents(entries: RecordedLog[]): RecordedLog[] {
    return entries.filter((e) => e.msg === 'query');
  }

  it('emits one debug `query` event for a SELECT with type, rows, ms and a single-lined query', async () => {
    const { logger, entries } = recordingLogger();
    const engine = new QueryEngine(exampleStore(), {
      id: 'people',
      mode: 'materialized',
      logger,
    });

    await engine.execute(
      'SELECT ?s ?o\nWHERE {\n  ?s <http://example.org/p> ?o\n}',
    );

    const events = queryEvents(entries);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe('debug');
    expect(events[0].fields).toMatchObject({
      source: 'people',
      mode: 'materialized',
      type: 'SELECT',
      rows: 1,
    });
    expect(typeof events[0].fields?.ms).toBe('number');
    expect(events[0].fields?.query).toBe(
      'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
    );
  });

  it.each([
    {
      verb: 'CONSTRUCT',
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    },
    { verb: 'DESCRIBE', query: 'DESCRIBE <http://example.org/a>' },
  ])('emits a `quads` count for $verb', async ({ verb, query }) => {
    const { logger, entries } = recordingLogger();
    const engine = new QueryEngine(exampleStore(), {
      id: 'people',
      mode: 'materialized',
      logger,
    });

    await engine.execute(query);

    const events = queryEvents(entries);
    expect(events).toHaveLength(1);
    expect(events[0].fields).toMatchObject({ type: verb, quads: 1 });
  });

  it('emits the `boolean` result for an ASK', async () => {
    const { logger, entries } = recordingLogger();
    const engine = new QueryEngine(exampleStore(), {
      id: 'people',
      mode: 'materialized',
      logger,
    });

    await engine.execute('ASK WHERE { ?s <http://example.org/p> ?o }');

    const events = queryEvents(entries);
    expect(events).toHaveLength(1);
    expect(events[0].fields).toMatchObject({ type: 'ASK', boolean: true });
  });

  it('emits an `error` outcome when an endpoint source fails', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      status: 500,
      body: 'boom',
    }));
    try {
      const { logger, entries } = recordingLogger();
      const engine = new QueryEngine(
        { kind: 'endpoint', endpoint: endpoint.url },
        { id: endpoint.url, mode: 'pass-through', logger },
      );

      await expect(
        engine.execute('SELECT ?s WHERE { ?s ?p ?o }'),
      ).rejects.toThrow();

      const events = queryEvents(entries);
      expect(events).toHaveLength(1);
      expect(events[0].fields).toMatchObject({
        mode: 'pass-through',
        outcome: 'error',
      });
      expect(typeof events[0].fields?.error).toBe('string');
    } finally {
      await endpoint.close();
    }
  });
});

describe('QueryEngine.executeResult', () => {
  it('returns Result.ok with the same payload as execute on the happy path', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.executeResult(
      'SELECT ?s WHERE { ?s ?p ?o }',
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.format).toBe('json');
    expect(result.value.contentType).toBe('application/sparql-results+json');
    JSON.parse(result.value.body);
  });

  it('returns Result.err with a query-execution variant on a malformed SPARQL string', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.executeResult('SELECT ?s WHERE { ?s ?p');

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('query-execution');
    if (result.error.kind !== 'query-execution') throw new Error('unreachable');
    expect(result.error.query).toBe('SELECT ?s WHERE { ?s ?p');
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('returns Result.err with a query-execution variant when format conflicts with result type', async () => {
    const engine = new QueryEngine(exampleStore());

    const result = await engine.executeResult(
      'SELECT ?s WHERE { ?s ?p ?o }',
      { format: 'turtle' },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('query-execution');
    if (result.error.kind !== 'query-execution') throw new Error('unreachable');
    expect(result.error.message).toMatch(/turtle|incompatible/i);
  });

  it('returns Result.err with an endpoint-fetch variant naming the endpoint URL when the remote 500s', async () => {
    const endpoint = await startFakeSparqlEndpoint(() => ({
      status: 500,
      body: 'boom',
    }));
    try {
      const engine = new QueryEngine({
        kind: 'endpoint',
        endpoint: endpoint.url,
      });

      const result = await engine.executeResult(
        'SELECT ?s WHERE { ?s ?p ?o }',
      );

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) throw new Error('unreachable');
      expect(result.error.kind).toBe('endpoint-fetch');
      if (result.error.kind !== 'endpoint-fetch') throw new Error('unreachable');
      expect(result.error.endpoint).toBe(endpoint.url);
    } finally {
      await endpoint.close();
    }
  });
});
