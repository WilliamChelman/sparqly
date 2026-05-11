import { describe, expect, it } from 'vitest';
import { parseSparqlPrefixes } from './parse-sparql-prefixes';

describe('parseSparqlPrefixes', () => {
  it('extracts a single PREFIX declaration', () => {
    const query = [
      'PREFIX ex: <http://example.org/>',
      'SELECT ?s WHERE { ?s a ex:Thing }',
    ].join('\n');
    expect(parseSparqlPrefixes(query)).toEqual({
      ex: 'http://example.org/',
    });
  });

  it('extracts multiple PREFIX declarations', () => {
    const query = [
      'PREFIX ex: <http://example.org/>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'SELECT ?s WHERE { ?s foaf:name ?n }',
    ].join('\n');
    expect(parseSparqlPrefixes(query)).toEqual({
      ex: 'http://example.org/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    });
  });

  it('matches the PREFIX keyword case-insensitively', () => {
    const query = 'prefix ex: <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }';
    expect(parseSparqlPrefixes(query)).toEqual({
      ex: 'http://example.org/',
    });
  });

  it('records the empty prefix label as ""', () => {
    const query = 'PREFIX : <urn:default/>\nSELECT * WHERE { ?s ?p ?o }';
    expect(parseSparqlPrefixes(query)).toEqual({ '': 'urn:default/' });
  });

  it('returns {} when the query has no PREFIX declarations', () => {
    expect(parseSparqlPrefixes('SELECT * WHERE { ?s ?p ?o }')).toEqual({});
  });
});
