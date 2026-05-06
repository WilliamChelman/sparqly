import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeHtmlDiff } from './html-diff-composer';

const UPDATE = process.env.UPDATE_GOLDENS === '1';

async function readOrWrite(path: string, actual: string): Promise<string> {
  if (UPDATE) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, actual, 'utf8');
  }
  return readFile(path, 'utf8');
}

const FIXTURES = join(__dirname, '__fixtures__', 'diff-html');

const t = (iri: string): string => `<http://example.org/${iri}>`;
const triple = (s: string, p: string, o: string): string =>
  `${t(s)} ${t(p)} ${t(o)} .`;

const emptySnippets = new Map();

describe('composeHtmlDiff — golden fixtures', () => {
  it('minimal both-sides annotated: byte-identical to fixture', async () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [removed], totals: { left: 1, right: 1 } },
      {
        left: new Map([
          [removed, [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map([
          [added, [{ file: 'file:///cwd/b.ttl', line: 3 }]],
        ]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'minimal-both-sides-annotated.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('no records on either side (warning path): byte-identical to fixture', async () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [removed], totals: { left: 1, right: 1 } },
      { left: new Map(), right: new Map() },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'no-records.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('mixed sides (left annotated, right not): byte-identical to fixture', async () => {
    const removed = triple('c', 'q', 'd');
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [removed], totals: { left: 1, right: 1 } },
      {
        left: new Map([
          [removed, [{ file: 'file:///cwd/a.ttl', line: 7 }]],
        ]),
        right: new Map(),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'mixed-sides.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('snippet rendering with context=3: byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      new Map([
        [
          'file:///cwd/foo.ttl:5',
          {
            kind: 'snippet' as const,
            startLine: 2,
            focalLine: 5,
            lines: [
              '@prefix ex: <http://example.org/> .',
              '',
              'ex:a ex:p ex:b .',
              'ex:c ex:q ex:d .',
              'ex:e ex:r ex:f .',
              '',
              'ex:g ex:s ex:h .',
            ],
          },
        ],
      ]),
      { cwd: '/cwd', context: 3 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-context-3.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('snippet rendering with context=0 (focal line only): byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      new Map([
        [
          'file:///cwd/foo.ttl:5',
          {
            kind: 'snippet' as const,
            startLine: 5,
            focalLine: 5,
            lines: ['ex:e ex:r ex:f .'],
          },
        ],
      ]),
      { cwd: '/cwd', context: 0 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-context-0.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('snippet near top boundary (truncated top window): byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 1 }]]]),
      },
      new Map([
        [
          'file:///cwd/foo.ttl:1',
          {
            kind: 'snippet' as const,
            startLine: 1,
            focalLine: 1,
            lines: [
              '@prefix ex: <http://example.org/> .',
              '',
              'ex:a ex:p ex:b .',
              'ex:c ex:q ex:d .',
            ],
          },
        ],
      ]),
      { cwd: '/cwd', context: 3 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-top-boundary.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('record with no line (file-only, e.g. JSON-LD/RDF-XML): byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.jsonld' }]]]),
      },
      emptySnippets,
      { cwd: '/cwd' },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'line-not-available.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('source file unavailable at render time (snippet result is `unavailable`): byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      new Map([
        [
          'file:///cwd/foo.ttl:5',
          { kind: 'unavailable' as const, reason: 'missing' as const },
        ],
      ]),
      { cwd: '/cwd', context: 3 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'source-file-unavailable.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('snippet cap exceeded: 10 inline + remainder in a single <details>: byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const records = Array.from({ length: 13 }, (_, i) => ({
      file: 'file:///cwd/foo.ttl',
      line: i + 1,
    }));
    const snippets = new Map(
      records.map((r) => [
        `${r.file}:${r.line}`,
        {
          kind: 'snippet' as const,
          startLine: r.line,
          focalLine: r.line,
          lines: [`line ${r.line}`],
        },
      ]),
    );
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      { left: new Map(), right: new Map([[added, records]]) },
      snippets,
      { cwd: '/cwd', context: 0 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-cap-exceeded.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('exactly-10 boundary: no <details> wrapper: byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const records = Array.from({ length: 10 }, (_, i) => ({
      file: 'file:///cwd/foo.ttl',
      line: i + 1,
    }));
    const snippets = new Map(
      records.map((r) => [
        `${r.file}:${r.line}`,
        {
          kind: 'snippet' as const,
          startLine: r.line,
          focalLine: r.line,
          lines: [`line ${r.line}`],
        },
      ]),
    );
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      { left: new Map(), right: new Map([[added, records]]) },
      snippets,
      { cwd: '/cwd', context: 0 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-cap-exactly-10.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('snippet near bottom boundary (truncated bottom window): byte-identical to fixture', async () => {
    const added = triple('e', 'r', 'f');
    const out = composeHtmlDiff(
      { added: [added], removed: [], totals: { left: 0, right: 1 } },
      {
        left: new Map(),
        right: new Map([[added, [{ file: 'file:///cwd/foo.ttl', line: 5 }]]]),
      },
      new Map([
        [
          'file:///cwd/foo.ttl:5',
          {
            kind: 'snippet' as const,
            startLine: 2,
            focalLine: 5,
            lines: [
              '',
              'ex:a ex:p ex:b .',
              'ex:c ex:q ex:d .',
              'ex:e ex:r ex:f .',
            ],
          },
        ],
      ]),
      { cwd: '/cwd', context: 3 },
    );

    const golden = await readOrWrite(
      join(FIXTURES, 'snippet-bottom-boundary.html'),
      out,
    );
    expect(out).toBe(golden);
  });
});
