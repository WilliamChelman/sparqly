import { describe, expect, it } from 'vitest';
import { SavedQueryEntrySchema } from './saved-query-entry';

describe('SavedQueryEntrySchema', () => {
  it('accepts a minimal literal entry (slug + body)', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'my-query',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.slug).toBe('my-query');
      expect(parsed.data.body).toBe('SELECT * WHERE { ?s ?p ?o }');
      expect(parsed.data.description).toBeUndefined();
    }
  });

  it('accepts an optional description', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'q',
      description: 'human-friendly text',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.description).toBe('human-friendly text');
    }
  });

  it('rejects a slug that starts with a hyphen', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: '-bad',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a slug containing uppercase letters', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'BadSlug',
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a slug longer than 63 characters', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'a' + 'b'.repeat(63),
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a slug at the 63-character boundary', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'a' + 'b'.repeat(62),
      body: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an empty body', () => {
    const parsed = SavedQueryEntrySchema.safeParse({
      slug: 'q',
      body: '',
    });
    expect(parsed.success).toBe(false);
  });
});
