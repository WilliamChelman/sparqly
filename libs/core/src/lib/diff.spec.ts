import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { describe, expect, it } from 'vitest';
import {
  diffCanonicalStatements,
  diffStores,
  formatRdfDiff,
  type RdfDiffResult,
} from './diff';
import { parseSourceSpec } from './source-spec';
import { resolveSource } from './resolve-source';
import { extractAnnotationPredicates } from './annotate-transform';
import type { Store } from 'n3';

interface ResolvedSide {
  store: Store;
  annotationPredicates: ReturnType<typeof extractAnnotationPredicates>;
}

async function resolveAnnotated(spec: unknown): Promise<ResolvedSide> {
  const parsed = parseSourceSpec(spec as never);
  const r = await resolveSource(parsed);
  if (r.mode !== 'materialized') throw new Error('expected materialized');
  return {
    store: r.store,
    annotationPredicates: extractAnnotationPredicates(
      parsed.kind === 'glob' ? parsed.transforms : undefined,
    ),
  };
}

const t = (iri: string): string => `<http://example.org/${iri}>`;
const triple = (s: string, p: string, o: string): string =>
  `${t(s)} ${t(p)} ${t(o)} .`;
const quad = (s: string, p: string, o: string, g: string): string =>
  `${t(s)} ${t(p)} ${t(o)} ${t(g)} .`;

describe('diffCanonicalStatements + formatRdfDiff', () => {
  it('human format emits removed lines, then added lines, each prefixed and newline-terminated', () => {
    const left = [triple('a', 'p', 'b'), triple('c', 'q', 'd')];
    const right = [triple('a', 'p', 'b'), triple('e', 'r', 'f')];

    const out = formatRdfDiff(diffCanonicalStatements(left, right), 'human');

    expect(out).toBe(
      `- ${triple('c', 'q', 'd')}\n` + `+ ${triple('e', 'r', 'f')}\n`,
    );
  });

  it('json format emits {added,removed} with termType, value, and language tag for literals', () => {
    const added = `${t('c')} ${t('q')} "hi"@en .`;
    const diff: RdfDiffResult = { added: [added], removed: [] };

    const parsed = JSON.parse(formatRdfDiff(diff, 'json'));

    expect(parsed.removed).toEqual([]);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].s).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/c',
    });
    expect(parsed.added[0].p).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/q',
    });
    expect(parsed.added[0].o).toMatchObject({
      termType: 'Literal',
      value: 'hi',
      language: 'en',
    });
    expect(parsed.added[0].g).toBeUndefined();
  });

  it('json format emits a graph component for statements outside the default graph', () => {
    const removed = quad('a', 'p', 'b', 'g1');
    const added = triple('a', 'p', 'b');
    const diff: RdfDiffResult = { added: [added], removed: [removed] };

    const parsed = JSON.parse(formatRdfDiff(diff, 'json'));

    expect(parsed.removed).toHaveLength(1);
    expect(parsed.removed[0].g).toEqual({
      termType: 'NamedNode',
      value: 'http://example.org/g1',
    });
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].g).toBeUndefined();
  });

  it('human format with sourceRecords appends trailing # path:line comments per hunk, drawing left records on -, right records on +', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'human', {
      cwd: '/cwd',
      sourceRecords: {
        left: new Map([
          [triple('c', 'q', 'd'), [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map([
          [triple('e', 'r', 'f'), [{ file: 'file:///cwd/b.ttl', line: 3 }]],
        ]),
      },
    });

    expect(out).toBe(
      `- ${triple('c', 'q', 'd')} # a.ttl:7\n` +
        `+ ${triple('e', 'r', 'f')} # b.ttl:3\n`,
    );
  });

  it('human format with no sourceRecords (or empty maps) is byte-identical to today (regression guard)', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const baseline = formatRdfDiff(diff, 'human');
    const withEmpty = formatRdfDiff(diff, 'human', {
      cwd: '/cwd',
      sourceRecords: { left: new Map(), right: new Map() },
    });
    expect(withEmpty).toBe(baseline);
  });

  it('rdf-patch format emits all D markers before any A marker', () => {
    const left = [triple('a', 'p', 'b'), triple('c', 'q', 'd')];
    const right = [triple('a', 'p', 'b'), triple('e', 'r', 'f')];

    const out = formatRdfDiff(
      diffCanonicalStatements(left, right),
      'rdf-patch',
    );

    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^D /);
    expect(lines[1]).toMatch(/^A /);
  });

  it('diffStores returns per-side source-record maps keyed by canonical N-Quads (annotated globs)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-srcrec-'));
    try {
      const leftFile = join(dir, 'left.ttl');
      const rightFile = join(dir, 'right.ttl');
      await writeFile(
        leftFile,
        dedent`
          @prefix ex: <http://example.org/> .
          ex:a ex:p ex:b .
          ex:c ex:q ex:d .
        ` + '\n',
      );
      await writeFile(
        rightFile,
        dedent`
          @prefix ex: <http://example.org/> .
          ex:a ex:p ex:b .
          ex:e ex:r ex:f .
        ` + '\n',
      );

      const left = await resolveAnnotated({
        glob: leftFile,
        transforms: [{ annotate: {} }],
      });
      const right = await resolveAnnotated({
        glob: rightFile,
        transforms: [{ annotate: {} }],
      });

      const result = await diffStores(left, right);

      // Diff still reports added/removed canonical N-Quads.
      expect(result.removed).toHaveLength(1);
      expect(result.added).toHaveLength(1);

      // Removed key resolves to the left source record.
      const removedKey = result.removed[0];
      const removedRecords = result.sourceRecords.left.get(removedKey);
      expect(removedRecords).toHaveLength(1);
      expect(removedRecords?.[0].file).toBe(`file://${leftFile}`);
      expect(removedRecords?.[0].line).toBe(3);

      // Added key resolves to the right source record.
      const addedKey = result.added[0];
      const addedRecords = result.sourceRecords.right.get(addedKey);
      expect(addedRecords).toHaveLength(1);
      expect(addedRecords?.[0].file).toBe(`file://${rightFile}`);
      expect(addedRecords?.[0].line).toBe(3);

      // Cross-side keys are not populated.
      expect(result.sourceRecords.right.get(removedKey)).toBeUndefined();
      expect(result.sourceRecords.left.get(addedKey)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('diffStores buckets multiple SourceRecords under one key when the same triple is authored in two files (story 16)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-multi-'));
    try {
      const a = join(dir, 'a.ttl');
      const b = join(dir, 'b.ttl');
      const ttl =
        dedent`
          @prefix ex: <http://example.org/> .
          ex:a ex:p ex:b .
        ` + '\n';
      await writeFile(a, ttl);
      await writeFile(b, ttl);

      // Left contains the same triple in two files; right is empty-ish (a
      // different triple) so the shared triple shows up under `removed`.
      const left = await resolveAnnotated({
        glob: join(dir, '*.ttl'),
        transforms: [{ annotate: {} }],
      });
      const otherFile = join(dir, 'other.nt');
      await writeFile(
        otherFile,
        '<http://example.org/x> <http://example.org/y> <http://example.org/z> .\n',
      );
      const right = await resolveAnnotated({
        glob: otherFile,
        transforms: [{ annotate: {} }],
      });

      const result = await diffStores(left, right);

      const removedKey = result.removed.find((s) =>
        s.includes('<http://example.org/a>'),
      );
      expect(removedKey).toBeDefined();
      const records = result.sourceRecords.left.get(removedKey as string);
      expect(records).toHaveLength(2);
      const files = records?.map((r) => r.file).sort();
      expect(files).toEqual([`file://${a}`, `file://${b}`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('diffStores resolves a bnode-involving difference through the canonical b-node label mapping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-bnode-'));
    try {
      // Left has an extra bnode-rooted triple that the right does not have.
      const leftFile = join(dir, 'left.ttl');
      await writeFile(
        leftFile,
        dedent`
          @prefix ex: <http://example.org/> .
          ex:s ex:p _:x .
          _:x ex:q "v" .
          _:x ex:extra "only-on-left" .
        ` + '\n',
      );
      const rightFile = join(dir, 'right.ttl');
      await writeFile(
        rightFile,
        dedent`
          @prefix ex: <http://example.org/> .
          ex:s ex:p _:y .
          _:y ex:q "v" .
        ` + '\n',
      );

      const left = await resolveAnnotated({
        glob: leftFile,
        transforms: [{ annotate: {} }],
      });
      const right = await resolveAnnotated({
        glob: rightFile,
        transforms: [{ annotate: {} }],
      });

      const result = await diffStores(left, right);

      // The "only-on-left" triple involves a blank node — the canonical key
      // must mention `_:c14n…`, and the lookup must still resolve via the
      // b-node label mapping.
      const extraKey = result.removed.find((s) => s.includes('only-on-left'));
      expect(extraKey).toBeDefined();
      expect(extraKey).toMatch(/_:c14n\d+/);
      const records = result.sourceRecords.left.get(extraKey as string);
      expect(records).toHaveLength(1);
      expect(records?.[0].file).toBe(`file://${leftFile}`);
      expect(records?.[0].line).toBe(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('diffStores returns empty source-record maps when neither side declared annotate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-noannot-'));
    try {
      const leftFile = join(dir, 'left.ttl');
      await writeFile(
        leftFile,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n',
      );
      const rightFile = join(dir, 'right.ttl');
      await writeFile(
        rightFile,
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:e ex:r ex:f .\n',
      );

      const left = await resolveAnnotated({ glob: leftFile });
      const right = await resolveAnnotated({ glob: rightFile });

      const result = await diffStores(left, right);

      // Behaviour for added/removed is unchanged.
      expect(result.added).toHaveLength(1);
      expect(result.removed).toHaveLength(0);
      // Maps exist but are empty.
      expect(result.sourceRecords.left.size).toBe(0);
      expect(result.sourceRecords.right.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('output is stable: same inputs produce byte-identical output across invocations, and added/removed are sorted', () => {
    const left = [
      triple('c', 'p', 'c2'),
      triple('a', 'p', 'a2'),
      triple('b', 'p', 'b2'),
    ];
    const right = [triple('a', 'p', 'a2')];

    const first = formatRdfDiff(diffCanonicalStatements(left, right), 'human');
    const second = formatRdfDiff(diffCanonicalStatements(left, right), 'human');

    expect(first).toBe(second);

    const removed = first
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2));
    expect(removed).toEqual([...removed].sort());
    expect(removed).toHaveLength(2);
  });
});
