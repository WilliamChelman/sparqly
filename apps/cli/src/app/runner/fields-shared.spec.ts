import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sourceField } from './fields-shared';

const schema = z.object({ source: sourceField.schema });

describe('sourceField — single-target shape', () => {
  it('accepts a single string source', () => {
    expect(schema.safeParse({ source: 'data/*.ttl' }).success).toBe(true);
  });

  it('accepts a single object source', () => {
    expect(
      schema.safeParse({ source: { glob: 'data/*.ttl' } }).success,
    ).toBe(true);
  });

  it('rejects an array `--source` value with a message naming the escape routes and linking ADR-0005', () => {
    const result = schema.safeParse({ source: ['a/*.ttl', 'b/*.ttl'] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues
      .map((i) => i.message)
      .join('\n');
    expect(message).toMatch(/single/i);
    expect(message).toMatch(/SERVICE/);
    expect(message).toMatch(/empty/);
    expect(message).toMatch(/ADR-0005|0005-single-target-source/);
  });

  it('uses field key "source" (singular)', () => {
    expect(sourceField.key).toBe('source');
  });

  it('exposes a `--source` flag spec (singular)', () => {
    const specs = (sourceField.flags ?? []).map((f) => f.spec);
    expect(specs.some((s) => s.includes('--source '))).toBe(true);
    for (const s of specs) expect(s).not.toMatch(/--sources\b/);
  });
});

describe('sourceField — endpoint sources reject graph/graphMode', () => {
  it('rejects an endpoint object that carries graphMode', () => {
    const result = schema.safeParse({
      source: { endpoint: 'https://example.com/sparql', graphMode: 'forceAll' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an endpoint object that carries graph', () => {
    const result = schema.safeParse({
      source: { endpoint: 'https://example.com/sparql', graph: 'urn:my:graph' },
    });
    expect(result.success).toBe(false);
  });

  it('still accepts a glob object with graphMode', () => {
    const result = schema.safeParse({
      source: { glob: 'data/*.ttl', graphMode: 'forceAll' },
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a glob object with graph', () => {
    const result = schema.safeParse({
      source: { glob: 'data/*.ttl', graph: 'urn:g' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bare endpoint object without graph fields', () => {
    const result = schema.safeParse({
      source: { endpoint: 'https://example.com/sparql' },
    });
    expect(result.success).toBe(true);
  });
});
