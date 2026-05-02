import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sourcesField } from './fields-shared';

const schema = z.object({ sources: sourcesField.schema });

describe('sourcesField — endpoint sources reject graph/graphMode', () => {
  it('rejects an endpoint object that carries graphMode', () => {
    const result = schema.safeParse({
      sources: { endpoint: 'https://example.com/sparql', graphMode: 'forceAll' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an endpoint object that carries graph', () => {
    const result = schema.safeParse({
      sources: { endpoint: 'https://example.com/sparql', graph: 'urn:my:graph' },
    });
    expect(result.success).toBe(false);
  });

  it('still accepts a glob object with graphMode', () => {
    const result = schema.safeParse({
      sources: { glob: 'data/*.ttl', graphMode: 'forceAll' },
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a glob object with graph', () => {
    const result = schema.safeParse({
      sources: { glob: 'data/*.ttl', graph: 'urn:g' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bare endpoint object without graph fields', () => {
    const result = schema.safeParse({
      sources: { endpoint: 'https://example.com/sparql' },
    });
    expect(result.success).toBe(true);
  });
});
