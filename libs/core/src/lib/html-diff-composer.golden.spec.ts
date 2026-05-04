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
      { added: [added], removed: [removed] },
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
      { added: [added], removed: [removed] },
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
      { added: [added], removed: [removed] },
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
});
