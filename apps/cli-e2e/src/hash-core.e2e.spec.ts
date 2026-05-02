import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { hashFixture, leadingHash } from './helpers/hash';

describe('sparqly hash — core properties', () => {
  it('round-trip: hashing domain.ttl equals hashing parts/*.ttl after a content-preserving split', async () => {
    const single = hashFixture('domain.ttl');
    const partsGlob = hashFixture('parts/*.ttl');

    const [a, b] = await Promise.all([
      runCli(['hash', '--quiet', single]),
      runCli(['hash', '--quiet', partsGlob]),
    ]);

    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(a.stderr).toBe('');
    expect(b.stderr).toBe('');
    expect(a.stdout).toMatch(/^[0-9a-f]{64} {2}/);
    expect(leadingHash(a.stdout)).toBe(leadingHash(b.stdout));
  });

  it('drift detection: dropping one part flips the hash', async () => {
    const single = hashFixture('domain.ttl');
    const driftGlob = hashFixture('drift/*.ttl');

    const [a, b] = await Promise.all([
      runCli(['hash', '--quiet', single]),
      runCli(['hash', '--quiet', driftGlob]),
    ]);

    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(leadingHash(a.stdout)).not.toBe(leadingHash(b.stdout));
  });

  it('format coverage: ttl/nt/nq/trig/jsonld/rdf encoding the same triple produce the same hash', async () => {
    const formats = ['ttl', 'nt', 'nq', 'trig', 'jsonld', 'rdf'] as const;
    const results = await Promise.all(
      formats.map((ext) =>
        runCli(['hash', '--quiet', hashFixture(`formats/data.${ext}`)]),
      ),
    );

    for (const [i, result] of results.entries()) {
      expect(
        result.exitCode,
        `format ${formats[i]} stderr: ${result.stderr}`,
      ).toBe(0);
      expect(result.stdout).toMatch(/^[0-9a-f]{64} {2}/);
    }
    const hashes = results.map((r) => leadingHash(r.stdout));
    const [first, ...rest] = hashes;
    for (const h of rest) expect(h).toBe(first);
  });

  it('--graph-mode=flatten: a .trig with named graphs hashes the same as the equivalent triples-only .ttl, but differs without the flag', async () => {
    const trig = hashFixture('quad/data.trig');
    const ttl = hashFixture('quad/data-flat.ttl');

    const [withNone, withoutNone, ttlPlain] = await Promise.all([
      runCli(['hash', '--quiet', '--graph-mode=flatten', trig]),
      runCli(['hash', '--quiet', trig]),
      runCli(['hash', '--quiet', ttl]),
    ]);

    expect(withNone.exitCode).toBe(0);
    expect(withoutNone.exitCode).toBe(0);
    expect(ttlPlain.exitCode).toBe(0);
    expect(leadingHash(withNone.stdout)).toBe(leadingHash(ttlPlain.stdout));
    expect(leadingHash(withoutNone.stdout)).not.toBe(leadingHash(ttlPlain.stdout));
  });
});

describe('sparqly hash — argv and flag validation', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-hash-argv-'));
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('exits non-zero when the glob matches no files (no stdout)', async () => {
    const result = await runCli([
      'hash',
      '--quiet',
      join(scratch, 'nope-*.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/no files/i);
  });

  it('exits non-zero on an unknown --graph-mode value', async () => {
    const result = await runCli([
      'hash',
      '--quiet',
      '--graph-mode=bogus',
      join(scratch, '*.ttl'),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unknown.*--graph-mode/i);
  });

  it('exits non-zero when no sources are provided', async () => {
    const result = await runCli(['hash', '--quiet'], {
      env: {
        SPARQLY_HASH_SOURCES: undefined,
        SPARQLY_HASH_COMPARE_WITH: undefined,
      },
      cwd: scratch,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/sources/i);
  });
});
