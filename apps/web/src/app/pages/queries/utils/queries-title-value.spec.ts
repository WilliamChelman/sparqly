import { describe, expect, it } from 'vitest';
import { queriesTitleValue } from './queries-title-value';

describe('queriesTitleValue', () => {
  it('uses the slug of a loaded saved query', () => {
    expect(
      queriesTitleValue({
        kind: 'loaded',
        slug: 'orphaned-nodes',
        loadedBody: 'SELECT * WHERE { ?s ?p ?o }',
        loadedEtag: 'etag',
        loadedParameters: [],
      }),
    ).toBe('orphaned-nodes');
  });

  it('uses the slug while a saved query is loading', () => {
    expect(queriesTitleValue({ kind: 'loading', slug: 'big-query' })).toBe(
      'big-query',
    );
  });

  it("labels the create route 'New query'", () => {
    expect(
      queriesTitleValue({
        kind: 'create',
        origin: null,
        prefillBody: '',
        prefillParameters: [],
      }),
    ).toBe('New query');
  });

  it("labels an unknown slug 'Not found'", () => {
    expect(queriesTitleValue({ kind: 'not-found', slug: 'ghost' })).toBe(
      'Not found',
    );
  });

  it('is empty for the bare list', () => {
    expect(queriesTitleValue({ kind: 'empty' })).toBe('');
  });
});
