import { DataFactory, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { QueryEngine } from './query-engine';

const { namedNode, quad } = DataFactory;

function exampleStore(): Store {
  const store = new Store();
  store.addQuad(
    quad(
      namedNode('http://example.org/a'),
      namedNode('http://example.org/p'),
      namedNode('http://example.org/b'),
    ),
  );
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

    it('SELECT is unaffected by mutable=true', async () => {
      const engine = new QueryEngine(exampleStore());
      const result = await engine.execute(
        'SELECT ?s WHERE { ?s ?p ?o }',
        { mutable: true },
      );
      expect(result.format).toBe('json');
    });
  });
});
