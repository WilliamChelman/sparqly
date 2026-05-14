import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveAnonymousView,
  resolveAnonymousViewResult,
} from './anonymous-view-builder';

describe('resolveAnonymousView — cache bypass (regression for #83)', () => {
  let dataDir: string;
  let cwdSandbox: string;
  let originalCwd: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-anon-data-'));
    cwdSandbox = await mkdtemp(join(tmpdir(), 'sparqly-anon-cwd-'));
    originalCwd = process.cwd();
    process.chdir(cwdSandbox);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(cwdSandbox, { recursive: true, force: true });
  });

  it('runs the inline query and returns the scoped store', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      [
        '@prefix ex: <http://example.org/> .',
        'ex:keep ex:p ex:v1 .',
        'ex:drop ex:p ex:v2 .',
      ].join('\n'),
    );
    const store = await resolveAnonymousView({
      source: { glob: a },
      query:
        'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
    });
    const subjects = store
      .getQuads(null, null, null, null)
      .map((q) => q.subject.value);
    expect(subjects).toEqual(['http://example.org/keep']);
  });

  it('does not create a .sparqly/cache directory under cwd', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(a, '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .');
    await resolveAnonymousView({
      source: { glob: a },
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
    await expect(stat(join(cwdSandbox, '.sparqly'))).rejects.toThrow();
  });
});

describe('resolveAnonymousViewResult', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'sparqly-anon-result-data-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns Result.ok with the scoped Store for a valid anonymous view', async () => {
    const a = join(dataDir, 'a.ttl');
    await writeFile(
      a,
      '@prefix ex: <http://example.org/> . ex:keep ex:p ex:v .',
    );
    const result = await resolveAnonymousViewResult({
      source: { glob: a },
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    expect(result.value.size).toBe(1);
  });

  it('returns Result.err with a view-validation variant when neither query nor queryFile is supplied', async () => {
    const result = await resolveAnonymousViewResult({
      source: { glob: 'whatever.ttl' },
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-validation');
  });

  it('returns Result.err with a view-validation variant when both query and queryFile are supplied', async () => {
    const result = await resolveAnonymousViewResult({
      source: { glob: 'whatever.ttl' },
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryFile: 'whatever.rq',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-validation');
  });

  it('returns Result.err with a view-validation variant when the upstream is a `@id` reference', async () => {
    const result = await resolveAnonymousViewResult({
      source: '@some-id',
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    });
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) throw new Error('unreachable');
    expect(result.error.kind).toBe('view-validation');
  });
});
