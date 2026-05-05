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

  it('json format with sourceRecords adds an optional `sourceRecords` field per added/removed entry, drawing left records on removed and right records on added', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'json', {
      cwd: '/cwd',
      sourceRecords: {
        left: new Map([
          [triple('c', 'q', 'd'), [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map([
          [
            triple('e', 'r', 'f'),
            [
              { file: 'file:///cwd/b.ttl', line: 3 },
              { file: 'file:///cwd/b.ttl', line: 12 },
            ],
          ],
        ]),
      },
    });

    const parsed = JSON.parse(out);
    expect(parsed.removed).toHaveLength(1);
    expect(parsed.removed[0].sourceRecords).toEqual([
      { file: 'file:///cwd/a.ttl', line: 7 },
    ]);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].sourceRecords).toEqual([
      { file: 'file:///cwd/b.ttl', line: 3 },
      { file: 'file:///cwd/b.ttl', line: 12 },
    ]);
  });

  it('json format omits `sourceRecords` when no records are present (regression guard, byte-identical)', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const baseline = formatRdfDiff(diff, 'json');
    const withEmpty = formatRdfDiff(diff, 'json', {
      cwd: '/cwd',
      sourceRecords: { left: new Map(), right: new Map() },
    });
    expect(withEmpty).toBe(baseline);

    const parsed = JSON.parse(baseline);
    expect(parsed.added[0].sourceRecords).toBeUndefined();
    expect(parsed.removed[0].sourceRecords).toBeUndefined();
  });

  it('json format with a record carrying only `file` (no `line`) preserves that shape per entry', () => {
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements([], right);

    const out = formatRdfDiff(diff, 'json', {
      cwd: '/cwd',
      sourceRecords: {
        left: new Map(),
        right: new Map([
          [triple('e', 'r', 'f'), [{ file: 'file:///cwd/c.jsonld' }]],
        ]),
      },
    });

    const parsed = JSON.parse(out);
    expect(parsed.added[0].sourceRecords).toEqual([
      { file: 'file:///cwd/c.jsonld' },
    ]);
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

  it('rdf-patch format with sourceRecords appends trailing # path:line comments per D/A line, drawing left records on D and right records on A', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'rdf-patch', {
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
      `D ${triple('c', 'q', 'd')} # a.ttl:7\n` +
        `A ${triple('e', 'r', 'f')} # b.ttl:3\n`,
    );
  });

  it('rdf-patch format with no sourceRecords (or empty maps) is byte-identical to today (regression guard)', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const baseline = formatRdfDiff(diff, 'rdf-patch');
    const withEmpty = formatRdfDiff(diff, 'rdf-patch', {
      cwd: '/cwd',
      sourceRecords: { left: new Map(), right: new Map() },
    });
    expect(withEmpty).toBe(baseline);
  });

  it('rdf-patch format compresses multiple records per file and joins multiple files with `;` (shared with human)', () => {
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements([], right);

    const out = formatRdfDiff(diff, 'rdf-patch', {
      cwd: '/cwd',
      sourceRecords: {
        left: new Map(),
        right: new Map([
          [
            triple('e', 'r', 'f'),
            [
              { file: 'file:///cwd/a.ttl', line: 12 },
              { file: 'file:///cwd/a.ttl', line: 5 },
              { file: 'file:///cwd/b.ttl', line: 3 },
            ],
          ],
        ]),
      },
    });

    expect(out).toBe(
      `A ${triple('e', 'r', 'f')} # a.ttl:5,12; b.ttl:3\n`,
    );
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
        transforms: [{ annotateSource: {} }],
      });
      const right = await resolveAnnotated({
        glob: rightFile,
        transforms: [{ annotateSource: {} }],
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
        transforms: [{ annotateSource: {} }],
      });
      const otherFile = join(dir, 'other.nt');
      await writeFile(
        otherFile,
        '<http://example.org/x> <http://example.org/y> <http://example.org/z> .\n',
      );
      const right = await resolveAnnotated({
        glob: otherFile,
        transforms: [{ annotateSource: {} }],
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
        transforms: [{ annotateSource: {} }],
      });
      const right = await resolveAnnotated({
        glob: rightFile,
        transforms: [{ annotateSource: {} }],
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

  it('diffStores returns empty source-record maps when neither side declared annotateSource', async () => {
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

  it('turtle format emits one statement per line — no `;` grouping when subjects repeat', () => {
    const left: string[] = [];
    const right = [
      triple('a', 'p', 'b1'),
      triple('a', 'p', 'b2'),
      triple('a', 'q', 'c'),
    ];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'turtle', {
      prefixes: { ex: 'http://example.org/' },
    });

    expect(out).not.toContain(';');
    expect(out).not.toContain(',');
    const lines = out.split('\n').filter((l) => l.trim().length > 0);
    const statementLines = lines.filter(
      (l) => !l.startsWith('#') && !l.startsWith('@prefix'),
    );
    expect(statementLines).toEqual([
      'ex:a ex:p ex:b1 .',
      'ex:a ex:p ex:b2 .',
      'ex:a ex:q ex:c .',
    ]);
  });

  it('turtle format emits prefix declarations once at the top of each `# --- removed/added ---` block (not per statement)', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f1'), triple('e', 'r', 'f2')];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'turtle', {
      prefixes: { ex: 'http://example.org/' },
    });

    const removedHeaderIdx = out.indexOf('# --- removed ---');
    const addedHeaderIdx = out.indexOf('# --- added ---');
    expect(removedHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(addedHeaderIdx).toBeGreaterThan(removedHeaderIdx);

    const removedBlock = out.slice(removedHeaderIdx, addedHeaderIdx);
    const addedBlock = out.slice(addedHeaderIdx);

    // Each block has exactly one @prefix line (not one per statement).
    expect(removedBlock.match(/^@prefix /gm)?.length).toBe(1);
    expect(addedBlock.match(/^@prefix /gm)?.length).toBe(1);

    // The @prefix line precedes any statement line within its block.
    const firstPrefixIdx = addedBlock.indexOf('@prefix ex:');
    const firstStmtIdx = addedBlock.indexOf('ex:e');
    expect(firstPrefixIdx).toBeGreaterThan(0);
    expect(firstStmtIdx).toBeGreaterThan(firstPrefixIdx);
  });

  it('turtle format with sourceRecords emits a `# from <relative-path>:<line>` comment on the line directly above each statement, drawing left records on removed and right records on added', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const out = formatRdfDiff(diff, 'turtle', {
      cwd: '/cwd',
      prefixes: { ex: 'http://example.org/' },
      sourceRecords: {
        left: new Map([
          [triple('c', 'q', 'd'), [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map([
          [triple('e', 'r', 'f'), [{ file: 'file:///cwd/b.ttl', line: 3 }]],
        ]),
      },
    });

    const lines = out.split('\n');
    const removedStmtIdx = lines.findIndex((l) => l === 'ex:c ex:q ex:d .');
    expect(removedStmtIdx).toBeGreaterThan(0);
    expect(lines[removedStmtIdx - 1]).toBe('# from a.ttl:7');

    const addedStmtIdx = lines.findIndex((l) => l === 'ex:e ex:r ex:f .');
    expect(addedStmtIdx).toBeGreaterThan(0);
    expect(lines[addedStmtIdx - 1]).toBe('# from b.ttl:3');
  });

  it('turtle format with no sourceRecords still applies the flat-statement layout but emits no `# from` comments (regression guard)', () => {
    const left = [triple('c', 'q', 'd')];
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements(left, right);

    const baseline = formatRdfDiff(diff, 'turtle', {
      prefixes: { ex: 'http://example.org/' },
    });
    const withEmpty = formatRdfDiff(diff, 'turtle', {
      cwd: '/cwd',
      prefixes: { ex: 'http://example.org/' },
      sourceRecords: { left: new Map(), right: new Map() },
    });
    expect(withEmpty).toBe(baseline);

    expect(baseline).not.toMatch(/^#\s*from\b/m);
    // Statements still on their own lines (flat layout preserved).
    expect(baseline).toContain('\nex:c ex:q ex:d .\n');
    expect(baseline).toContain('\nex:e ex:r ex:f .\n');
  });

  it('turtle format with multiple records on one statement emits one `# from <path>:<line>` per record on consecutive lines directly above the statement (structurally honest, no compression)', () => {
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements([], right);

    const out = formatRdfDiff(diff, 'turtle', {
      cwd: '/cwd',
      prefixes: { ex: 'http://example.org/' },
      sourceRecords: {
        left: new Map(),
        right: new Map([
          [
            triple('e', 'r', 'f'),
            [
              { file: 'file:///cwd/a.ttl', line: 5 },
              { file: 'file:///cwd/a.ttl', line: 12 },
              { file: 'file:///cwd/b.ttl', line: 3 },
            ],
          ],
        ]),
      },
    });

    const lines = out.split('\n');
    const stmtIdx = lines.findIndex((l) => l === 'ex:e ex:r ex:f .');
    expect(stmtIdx).toBeGreaterThanOrEqual(3);
    expect(lines[stmtIdx - 3]).toBe('# from a.ttl:5');
    expect(lines[stmtIdx - 2]).toBe('# from a.ttl:12');
    expect(lines[stmtIdx - 1]).toBe('# from b.ttl:3');
  });

  it('turtle format with a record carrying only `file` (no `line`) emits `# from <path>` without trailing colon-line', () => {
    const right = [triple('e', 'r', 'f')];
    const diff = diffCanonicalStatements([], right);

    const out = formatRdfDiff(diff, 'turtle', {
      cwd: '/cwd',
      prefixes: { ex: 'http://example.org/' },
      sourceRecords: {
        left: new Map(),
        right: new Map([
          [triple('e', 'r', 'f'), [{ file: 'file:///cwd/c.jsonld' }]],
        ]),
      },
    });

    const lines = out.split('\n');
    const stmtIdx = lines.findIndex((l) => l === 'ex:e ex:r ex:f .');
    expect(stmtIdx).toBeGreaterThan(0);
    expect(lines[stmtIdx - 1]).toBe('# from c.jsonld');
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
