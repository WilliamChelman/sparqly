import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatSourceError,
  resolveSourceResult,
} from './resolve-source-result';
import { parseSourceSpec, parseSourceSpecs } from './source-spec';

describe('resolveSourceResult — endpoint target', () => {
  it('returns Result.ok with pass-through mode for an endpoint target', async () => {
    const target = parseSourceSpec('http://example.org/sparql');
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('pass-through');
    if (result.value.mode !== 'pass-through') throw new Error('unreachable');
    expect(result.value.endpoint.endpoint).toBe('http://example.org/sparql');
  });
});

describe('resolveSourceResult — reference target', () => {
  it('returns Result.err with a reference-target variant', async () => {
    const target = { kind: 'reference' as const, ref: 'raw' };
    const result = await resolveSourceResult(target);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'reference-target' });
  });

  it('formatSourceError reproduces the legacy thrown message for reference targets', () => {
    expect(formatSourceError({ kind: 'reference-target' })).toBe(
      "resolveSource: `kind: 'reference'` entries are aliases, not data, and cannot be resolved as a target",
    );
  });
});

describe('resolveSourceResult — glob target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-glob-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('materializes a glob target into a Store with the loaded files', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const target = parseSourceSpec(join(dir, '*.ttl'));
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(1);
    expect(result.value.files).toHaveLength(1);
  });
});

describe('resolveSourceResult — empty target', () => {
  it('materializes an empty target into a fresh empty Store', async () => {
    const target = parseSourceSpec({ id: 'host', empty: true });
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.mode).toBe('materialized');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    expect(result.value.store.size).toBe(0);
    expect(result.value.files).toEqual([]);
  });
});

describe('resolveSourceResult — view target', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-rsr-view-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('walks the from: chain and materializes the view query result', async () => {
    await writeFile(
      join(dir, 'a.ttl'),
      [
        '@prefix ex: <http://example.org/> .',
        'ex:a ex:p ex:b .',
        'ex:c ex:p ex:d .',
      ].join('\n'),
    );

    const registry = parseSourceSpecs([
      { id: 'raw', glob: join(dir, '*.ttl') },
      {
        id: 'derived',
        from: '@raw',
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:r ?o } WHERE { ?s ex:p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const predicates = new Set(
      result.value.store
        .getQuads(null, null, null, null)
        .map((q) => q.predicate.value),
    );
    expect(predicates.has('http://example.org/r')).toBe(true);
  });

  it('wraps downstream throws as a legacy-message SourceError variant', async () => {
    const registry = parseSourceSpecs([
      {
        id: 'derived',
        from: '@missing',
        query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      },
    ]);
    const target = registry.find((s) => s.id === 'derived');
    if (!target) throw new Error('derived view missing from registry');

    const result = await resolveSourceResult(target, { registry });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('legacy-message');
    if (result.error.kind !== 'legacy-message') throw new Error('unreachable');
    expect(result.error.message.length).toBeGreaterThan(0);
    // format echoes the wrapped message verbatim.
    expect(formatSourceError(result.error)).toBe(result.error.message);
  });
});
