import { describe, expect, it } from 'vitest';
import { blockSchemaFromFields, defaultsFromFields } from '../runner/fields/field';
import { QueryErrorSignal } from './query-error';
import { querySpec, resolveQueryTargetResult } from './query';

describe('querySpec — single-target shape', () => {
  it('binds a single positional to the `source` field', () => {
    expect(querySpec.positionals).toEqual([
      { field: 'source', name: 'glob' },
    ]);
  });

  it('exposes no env mirrors on per-invocation fields per ADR-0010', () => {
    const perInvocation = ['query', 'queryFile', 'format', 'out', 'mutable'];
    for (const key of perInvocation) {
      const field = querySpec.fields.find((f) => f.key === key);
      expect(field, `field ${key}`).toBeDefined();
      expect(field?.env, `env on ${key}`).toBeUndefined();
    }
  });

  it('exposes a `--source` flag (singular) and no `--sources`', () => {
    const sourceFlags =
      querySpec.fields.find((f) => f.key === 'source')?.flags ?? [];
    expect(sourceFlags.length).toBeGreaterThan(0);
    for (const f of sourceFlags) {
      expect(f.spec).toMatch(/--source\b/);
      expect(f.spec).not.toMatch(/--sources\b/);
    }
    expect(querySpec.fields.find((f) => f.key === 'sources')?.flags ?? []).toEqual([]);
  });

  it('declares default mutable=false and no graphMode default', () => {
    const defaults = defaultsFromFields(querySpec.fields);
    expect(defaults).toMatchObject({
      mutable: false,
      verbose: false,
      quiet: false,
    });
    expect('graphMode' in defaults).toBe(false);
  });

  it('rejects unknown --format with the SUPPORTED_FORMATS enum (json, turtle)', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
    expect(schema.safeParse({ format: 'csv' }).success).toBe(false);
    expect(schema.safeParse({ format: 'json' }).success).toBe(true);
    expect(schema.safeParse({ format: 'turtle' }).success).toBe(true);
  });

  it('does not expose a top-level graphMode field (graph-name semantics live on transforms)', () => {
    expect(querySpec.fields.find((f) => f.key === 'graphMode')).toBeUndefined();
    const flagSpecs = querySpec.fields.flatMap((f) => f.flags ?? []).map(
      (f) => f.spec,
    );
    for (const s of flagSpecs) expect(s).not.toMatch(/--graph-mode/);
  });

  it('exposes both --mutable and --immutable flags writing to the mutable field', () => {
    const mutable = querySpec.fields.find((f) => f.key === 'mutable');
    expect(mutable).toBeDefined();
    const flagSpecs = (mutable?.flags ?? []).map((f) => f.spec);
    expect(flagSpecs).toContain('--mutable');
    expect(flagSpecs).toContain('--immutable [value]');
    for (const flag of mutable?.flags ?? []) {
      expect(flag.attributeName).toBe('mutable');
    }
  });

  it('exitCode returns 1 by default for non-signal errors', () => {
    expect(querySpec.exitCode(new Error('boom'))).toBe(1);
  });

  it('exposes a `--at <ref>` flag bound to the `at` field (ADR-0029)', () => {
    const at = querySpec.fields.find((f) => f.key === 'at');
    expect(at).toBeDefined();
    const specs = (at?.flags ?? []).map((f) => f.spec);
    expect(specs).toContain('--at <ref>');
  });

  it('exitCode routes QueryErrorSignal through queryErrorExitCode (per-variant)', () => {
    const signal = new QueryErrorSignal({
      kind: 'endpoint-fetch',
      endpoint: 'https://example.org/sparql',
      message: 'down',
    });
    expect(querySpec.exitCode(signal)).toBe(34);
  });
});

describe('querySpec — array `--source` rejection', () => {
  it('rejects an array `--source` value with the new ADR-0005-linked wording', () => {
    const schema = blockSchemaFromFields(querySpec.fields);
    const result = schema.safeParse({ source: ['a/*.ttl', 'b/*.ttl'] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.map((i) => i.message).join('\n');
    expect(message).toMatch(/single/i);
    expect(message).toMatch(/SERVICE/);
    expect(message).toMatch(/empty/);
    expect(message).toMatch(/ADR-0005|0005-single-target-source/);
  });
});

describe('resolveQueryTargetResult — selection precedence', () => {
  it('auto-picks the sole registry entry when no positional/--source is given', () => {
    const result = resolveQueryTargetResult({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('falls back to the `default: true` entry when no positional/--source is given', () => {
    const result = resolveQueryTargetResult({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
    });
    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'endpoint', id: 'live' });
  });

  it('errs `no-default-multi` with the available ids when the registry is ambiguous', () => {
    const result = resolveQueryTargetResult({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql' },
      ],
    });
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.kind).toBe('no-default-multi');
    if (err.kind === 'no-default-multi') {
      expect([...err.availableIds]).toEqual(['files', 'live']);
    }
  });

  it('errs `unknown-ref` when the explicit ref does not match any registry entry', () => {
    const result = resolveQueryTargetResult({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
      source: '@nope',
    });
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.kind).toBe('unknown-ref');
    if (err.kind === 'unknown-ref') {
      expect(err.ref).toBe('@nope');
    }
  });

  it('inline positional wins over a `default: true` entry', () => {
    const result = resolveQueryTargetResult({
      sources: [
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: 'adhoc/*.ttl',
    });
    expect(result._unsafeUnwrap()).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('explicit `@id` ref wins over a `default: true` entry', () => {
    const result = resolveQueryTargetResult({
      sources: [
        { id: 'files', glob: 'data/*.ttl' },
        { id: 'live', endpoint: 'https://example.com/sparql', default: true },
      ],
      source: '@files',
    });
    expect(result._unsafeUnwrap()).toMatchObject({ kind: 'glob', id: 'files' });
  });

  it('does not require any `sources` registry when an inline source is provided', () => {
    const result = resolveQueryTargetResult({ source: 'adhoc/*.ttl' });
    expect(result._unsafeUnwrap()).toEqual({ kind: 'glob', glob: 'adhoc/*.ttl' });
  });

  it('desugars `@id:ref` positional to the registry entry + `gitRef` (ADR-0029, #275)', () => {
    const result = resolveQueryTargetResult({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
      source: '@files:v1.2.0',
    });
    expect(result._unsafeUnwrap()).toMatchObject({
      kind: 'glob',
      id: 'files',
      glob: 'data/*.ttl',
      gitRef: 'v1.2.0',
    });
  });

  it('errors `unknown-ref` when the id part of `@id:ref` is not in the registry', () => {
    const result = resolveQueryTargetResult({
      sources: [{ id: 'files', glob: 'data/*.ttl' }],
      source: '@nope:v1.2',
    });
    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.kind).toBe('unknown-ref');
    if (err.kind === 'unknown-ref') {
      expect(err.ref).toBe('@nope');
    }
  });
});
