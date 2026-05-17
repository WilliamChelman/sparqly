import { describe, expect, it } from 'vitest';
import { deriveEntryEtag } from './entry-etag';

describe('deriveEntryEtag', () => {
  it('produces a 16-char lowercase hex string', () => {
    const etag = deriveEntryEtag({
      slug: 'q',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable across whitespace-only formatting differences', () => {
    const a = deriveEntryEtag({
      slug: 'q',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    const b = deriveEntryEtag({
      slug: 'q',
      body: 'SELECT *\nWHERE   {\n  ?s ?p ?o\n}',
    });
    // Same logical content (slug, description, body up to internal whitespace
    // collapse) → same ETag.
    expect(a).toBe(b);
  });

  it('changes when the body content changes', () => {
    const a = deriveEntryEtag({ slug: 'q', body: 'SELECT 1 {}' });
    const b = deriveEntryEtag({ slug: 'q', body: 'SELECT 2 {}' });
    expect(a).not.toBe(b);
  });

  it('changes when the slug changes', () => {
    const a = deriveEntryEtag({ slug: 'one', body: 'SELECT 1 {}' });
    const b = deriveEntryEtag({ slug: 'two', body: 'SELECT 1 {}' });
    expect(a).not.toBe(b);
  });

  it('changes when the description is added', () => {
    const a = deriveEntryEtag({ slug: 'q', body: 'SELECT 1 {}' });
    const b = deriveEntryEtag({
      slug: 'q',
      description: 'now described',
      body: 'SELECT 1 {}',
    });
    expect(a).not.toBe(b);
  });
});
