import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { blockSchemaFromFields } from '../runner/field';
import { formatSpec } from './format';

describe('formatSpec', () => {
  it('declares one positional bound to sources', () => {
    expect(formatSpec.positionals).toEqual([
      { field: 'sources', name: 'glob' },
    ]);
  });

  it('rejects --write combined with --check via spec.refine', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    const result = schema.safeParse({ write: true, check: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = (result as z.ZodSafeParseError<unknown>).error.issues.map(
        (i) => i.message,
      );
      expect(messages).toContain('--write and --check are mutually exclusive');
    }
  });

  it('rejects --out combined with --write via spec.refine', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    const result = schema.safeParse({ out: 'x.ttl', write: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = (result as z.ZodSafeParseError<unknown>).error.issues.map(
        (i) => i.message,
      );
      expect(messages).toContain(
        '--out cannot be combined with --write or --check',
      );
    }
  });

  it('accepts --write alone or --check alone', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);
    expect(schema.safeParse({ write: true }).success).toBe(true);
    expect(schema.safeParse({ check: true }).success).toBe(true);
  });

  it('exposes a --prefix flag (string[]) field', () => {
    const prefix = formatSpec.fields.find((f) => f.key === 'prefix');
    expect(prefix).toBeDefined();
    expect(prefix?.flags?.[0].spec).toBe('--prefix <name=iri>');
  });

  it('exitCode returns 2 in --check mode and 1 otherwise', () => {
    expect(
      formatSpec.exitCode(new Error('x'), {
        rawConfig: { check: true },
      }),
    ).toBe(2);
    expect(formatSpec.exitCode(new Error('x'))).toBe(1);
  });

  it('rejects a SPARQL endpoint source via spec.refine, suggesting the query→format pipe', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);

    const stringResult = schema.safeParse({
      sources: 'http://example.org/sparql',
    });
    expect(stringResult.success).toBe(false);
    if (!stringResult.success) {
      const messages = (
        stringResult as z.ZodSafeParseError<unknown>
      ).error.issues.map((i) => i.message);
      expect(messages.some((m) => /SPARQL endpoint/.test(m))).toBe(true);
      expect(
        messages.some((m) =>
          /sparqly query --format=turtle.*sparqly format/.test(m),
        ),
      ).toBe(true);
    }

    const objectResult = schema.safeParse({
      sources: { endpoint: 'http://example.org/sparql', prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' },
    });
    expect(objectResult.success).toBe(false);
  });

  it('rejects prefilter/prefilterFile on a glob source via spec.refine', () => {
    const baseSchema = blockSchemaFromFields(formatSpec.fields);
    if (!formatSpec.refine) throw new Error('expected refine');
    const schema = formatSpec.refine(baseSchema);

    const prefilterResult = schema.safeParse({
      sources: { glob: 'data/**/*.ttl', prefilter: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }' },
    });
    expect(prefilterResult.success).toBe(false);
    if (!prefilterResult.success) {
      const messages = (
        prefilterResult as z.ZodSafeParseError<unknown>
      ).error.issues.map((i) => i.message);
      expect(messages.some((m) => /prefilter/.test(m))).toBe(true);
      expect(
        messages.some((m) =>
          /sparqly query --format=turtle.*sparqly format/.test(m),
        ),
      ).toBe(true);
    }

    const prefilterFileResult = schema.safeParse({
      sources: { glob: 'data/**/*.ttl', prefilterFile: 'q.rq' },
    });
    expect(prefilterFileResult.success).toBe(false);

    expect(
      schema.safeParse({ sources: { glob: 'data/**/*.ttl' } }).success,
    ).toBe(true);
  });
});
