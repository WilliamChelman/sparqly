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

describe('QueryEngine.select', () => {
  it('returns SPARQL JSON results for a SELECT query', async () => {
    const engine = new QueryEngine(exampleStore());

    const json = await engine.select(
      'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
    );

    const parsed = JSON.parse(json);
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings).toHaveLength(1);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(parsed.results.bindings[0].o.value).toBe('http://example.org/b');
  });

  it('rejects with a clear error on an invalid query', async () => {
    const engine = new QueryEngine(exampleStore());

    await expect(engine.select('SELECT ?s WHERE { ?s ?p')).rejects.toThrow();
  });
});
