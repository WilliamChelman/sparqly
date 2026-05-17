import { describe, expect, it } from 'vitest';
import {
  parseSidecar,
  serializeSidecar,
  upsertEntry,
  removeEntry,
  listEntries,
  getEntry,
  lintEntry,
} from './sidecar-io';

describe('parseSidecar / serializeSidecar', () => {
  it('round-trips an empty sidecar to itself', () => {
    const doc = parseSidecar('savedQueries: {}\n');
    expect(serializeSidecar(doc)).toBe('savedQueries: {}\n');
  });

  it('lists entries from a populated sidecar', () => {
    const text = [
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '  beta:',
      '    description: second',
      '    body: |',
      '      SELECT ?x WHERE { ?x ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(text);
    const slugs = listEntries(doc).map((e) => e.slug);
    expect(slugs).toEqual(['alpha', 'beta']);
  });

  it('returns a single entry by slug', () => {
    const doc = parseSidecar(
      [
        'savedQueries:',
        '  alpha:',
        '    description: first',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '',
      ].join('\n'),
    );
    const entry = getEntry(doc, 'alpha');
    expect(entry).toBeDefined();
    expect(entry?.slug).toBe('alpha');
    expect(entry?.description).toBe('first');
    expect(entry?.body.trim()).toBe('SELECT * WHERE { ?s ?p ?o }');
  });

  it('returns undefined for an unknown slug', () => {
    const doc = parseSidecar('savedQueries: {}\n');
    expect(getEntry(doc, 'nope')).toBeUndefined();
  });

  it('returns parameters when the entry declares them', () => {
    const doc = parseSidecar(
      [
        'savedQueries:',
        '  by-country:',
        '    body: |',
        '      SELECT * WHERE { ?country ?p ?o }',
        '    parameters:',
        '      - name: country',
        '        type: iri',
        '        cardinality: 1..1',
        '',
      ].join('\n'),
    );
    const entry = getEntry(doc, 'by-country');
    expect(entry?.parameters).toEqual([
      { name: 'country', type: 'iri', cardinality: '1..1' },
    ]);
  });
});

describe('upsertEntry / removeEntry — structure-aware writes', () => {
  it('preserves a leading comment when editing an unrelated entry', () => {
    const original = [
      '# Hand-edited library file.',
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '  beta:',
      '    body: |',
      '      ASK { ?s ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    upsertEntry(doc, {
      slug: 'beta',
      body: 'ASK { ?s ?p ?o . FILTER(?s != ?o) }',
    });
    const after = serializeSidecar(doc);
    expect(after).toMatch(/^# Hand-edited library file\./);
    expect(after).toContain('alpha:');
    expect(after).toContain('FILTER(?s != ?o)');
  });

  it('preserves an unknown hand-added field across a write to a different entry', () => {
    const original = [
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '    customField: keep-me',
      '  beta:',
      '    body: |',
      '      ASK { ?s ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    upsertEntry(doc, {
      slug: 'beta',
      body: 'ASK { ?s ?p ?o . FILTER(?s != ?o) }',
    });
    expect(serializeSidecar(doc)).toContain('customField: keep-me');
  });

  it('preserves declared key order across an unrelated edit', () => {
    const original = [
      'savedQueries:',
      '  zulu:',
      '    body: |',
      '      SELECT 1 {}',
      '  alpha:',
      '    body: |',
      '      SELECT 2 {}',
      '  middle:',
      '    body: |',
      '      SELECT 3 {}',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    upsertEntry(doc, { slug: 'middle', body: 'SELECT 99 {}' });
    const after = serializeSidecar(doc);
    const order = ['zulu', 'alpha', 'middle']
      .map((s) => ({ s, i: after.indexOf(`${s}:`) }));
    expect(order.every((o) => o.i >= 0)).toBe(true);
    expect(order[0].i).toBeLessThan(order[1].i);
    expect(order[1].i).toBeLessThan(order[2].i);
  });

  it('the on-disk diff for editing one entry touches only that entry s lines', () => {
    const original = [
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '  beta:',
      '    description: keep',
      '    body: |',
      '      ASK { ?s ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    upsertEntry(doc, {
      slug: 'beta',
      description: 'keep',
      body: 'ASK { ?x ?y ?z }',
    });
    const after = serializeSidecar(doc);
    const beforeLines = original.split('\n');
    const afterLines = after.split('\n');
    const alphaIdx = beforeLines.indexOf('  alpha:');
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    // alpha's block (alpha: + body: | + body content line) should be untouched
    expect(afterLines.slice(alphaIdx, alphaIdx + 3)).toEqual(
      beforeLines.slice(alphaIdx, alphaIdx + 3),
    );
  });

  it('appends a new entry preserving structure', () => {
    const original = [
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    upsertEntry(doc, { slug: 'beta', body: 'ASK { ?s ?p ?o }' });
    const after = serializeSidecar(doc);
    expect(after).toContain('alpha:');
    expect(after).toContain('beta:');
    expect(after.indexOf('alpha:')).toBeLessThan(after.indexOf('beta:'));
  });

  it('removes an entry while preserving siblings', () => {
    const original = [
      'savedQueries:',
      '  alpha:',
      '    body: |',
      '      SELECT * WHERE { ?s ?p ?o }',
      '  beta:',
      '    body: |',
      '      ASK { ?s ?p ?o }',
      '',
    ].join('\n');
    const doc = parseSidecar(original);
    const removed = removeEntry(doc, 'alpha');
    expect(removed).toBe(true);
    const after = serializeSidecar(doc);
    expect(after).not.toContain('alpha:');
    expect(after).toContain('beta:');
  });

  it('removeEntry returns false when the slug is not present', () => {
    const doc = parseSidecar('savedQueries: {}\n');
    expect(removeEntry(doc, 'missing')).toBe(false);
  });

  it('upserts a new entry with parameters serialized as a YAML list', () => {
    const doc = parseSidecar('savedQueries: {}\n');
    upsertEntry(doc, {
      slug: 'by-country',
      body: 'SELECT * WHERE { ?country ?p ?o }',
      parameters: [
        { name: 'country', type: 'iri', cardinality: '1..1' },
      ],
    });
    const text = serializeSidecar(doc);
    expect(text).toContain('parameters:');
    expect(text).toMatch(/- name: country/);
    expect(text).toMatch(/type: iri/);
    expect(text).toMatch(/cardinality: 1\.\.1/);
    // Sanity: round-trip.
    const round = getEntry(parseSidecar(text), 'by-country');
    expect(round?.parameters).toEqual([
      { name: 'country', type: 'iri', cardinality: '1..1' },
    ]);
  });

  it('lintEntry flags an entry whose declared parameter is missing from the body', () => {
    const doc = parseSidecar(
      [
        'savedQueries:',
        '  q:',
        '    body: |',
        '      SELECT * WHERE { ?s ?p ?o }',
        '    parameters:',
        '      - name: country',
        '        type: iri',
        '        cardinality: 1..1',
        '',
      ].join('\n'),
    );
    const entry = getEntry(doc, 'q');
    expect(entry).toBeDefined();
    const result = lintEntry(entry!);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('declared-but-unused');
    }
  });

  it('lintEntry passes when declarations match the body', () => {
    const doc = parseSidecar(
      [
        'savedQueries:',
        '  q:',
        '    body: |',
        '      SELECT * WHERE { ?country ?p ?o }',
        '    parameters:',
        '      - name: country',
        '        type: iri',
        '        cardinality: 1..1',
        '',
      ].join('\n'),
    );
    const entry = getEntry(doc, 'q');
    expect(lintEntry(entry!).isOk()).toBe(true);
  });

  it('removes the parameters field when upserting with parameters absent', () => {
    const doc = parseSidecar(
      [
        'savedQueries:',
        '  q:',
        '    body: |',
        '      SELECT * WHERE { ?country ?p ?o }',
        '    parameters:',
        '      - name: country',
        '        type: iri',
        '        cardinality: 1..1',
        '',
      ].join('\n'),
    );
    upsertEntry(doc, {
      slug: 'q',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    const text = serializeSidecar(doc);
    expect(text).not.toContain('parameters:');
  });
});
