import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { describe, expect, it } from 'vitest';
import { diffStores } from './diff';
import { groupRdfDiffByEntity } from './group-rdf-diff-by-entity';
import { composeHtmlDiff } from './html-diff-composer';
import type { SnippetReadResult } from './source-snippet-reader';

const UPDATE = process.env.UPDATE_GOLDENS === '1';

async function readOrWrite(path: string, actual: string): Promise<string> {
  if (UPDATE) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, actual, 'utf8');
  }
  return readFile(path, 'utf8');
}

const FIXTURES = join(__dirname, '..', '__fixtures__', 'diff-html');

const EX = 'http://example.org/';
const SH = 'http://www.w3.org/ns/shacl#';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const PREFIXES = { ex: EX, sh: SH, rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' };

const emptySnippets = new Map<string, SnippetReadResult>();

function storeOf(nquads: string): Store {
  const parser = new Parser({ format: 'application/n-quads' });
  const store = new Store();
  store.addQuads(parser.parse(nquads));
  return store;
}

async function buildHunked(left: string, right: string) {
  const leftStore = storeOf(left);
  const rightStore = storeOf(right);
  const diff = await diffStores({ store: leftStore }, { store: rightStore });
  return groupRdfDiffByEntity({
    diff,
    left: { store: leftStore },
    right: { store: rightStore },
  });
}

describe('composeHtmlDiff — golden fixtures', () => {
  it('empty diff: byte-identical to fixture', async () => {
    const out = composeHtmlDiff(
      { changed: [], removed: [], added: [], totals: { left: 0, right: 0 } },
      emptySnippets,
      { cwd: '/cwd', prefixes: PREFIXES },
    );
    const golden = await readOrWrite(join(FIXTURES, 'empty.html'), out);
    expect(out).toBe(golden);
  });

  it('changed/removed/added sections all populated, no source records: byte-identical to fixture', async () => {
    // Foo: changed (label flip). Bar: removed only. Baz: added only.
    const left =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${EX}label> "v1" .\n` +
      `<${EX}Bar> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Bar> <${EX}label> "Bar" .\n`;
    const right =
      `<${EX}Foo> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Foo> <${EX}label> "v2" .\n` +
      `<${EX}Baz> <${RDF_TYPE}> <${SH}NodeShape> .\n` +
      `<${EX}Baz> <${EX}label> "Baz" .\n`;
    const hunked = await buildHunked(left, right);
    const out = composeHtmlDiff(hunked, emptySnippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'three-sections-no-records.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('changed hunk with side-tinted chips and dedup snippet: byte-identical to fixture', async () => {
    const left = `<${EX}Foo> <${EX}label> "v1" .\n`;
    const right = `<${EX}Foo> <${EX}label> "v2" .\n`;
    const hunked = await buildHunked(left, right);
    // Stamp source records so chips render. The composer is pure over its
    // inputs, so we mutate the hunk we got back deterministically.
    hunked.changed[0].sourceRecords = {
      left: [{ file: 'file:///cwd/a.ttl', line: 7 }],
      right: [{ file: 'file:///cwd/b.ttl', line: 3 }],
    };
    const snippets = new Map<string, SnippetReadResult>([
      [
        'file:///cwd/a.ttl:7',
        { kind: 'snippet', startLine: 5, focalStart: 7, focalEnd: 7, lines: ['L5', 'L6', 'L7', 'L8', 'L9'] },
      ],
      [
        'file:///cwd/b.ttl:3',
        { kind: 'snippet', startLine: 1, focalStart: 3, focalEnd: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'] },
      ],
    ]);
    const out = composeHtmlDiff(hunked, snippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
      context: 3,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'changed-with-snippets.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('source file unavailable for one snippet: byte-identical to fixture', async () => {
    const left = ``;
    const right = `<${EX}Foo> <${EX}label> "v2" .\n`;
    const hunked = await buildHunked(left, right);
    hunked.added[0].sourceRecords = {
      left: [],
      right: [{ file: 'file:///cwd/foo.ttl', line: 5 }],
    };
    const snippets = new Map<string, SnippetReadResult>([
      [
        'file:///cwd/foo.ttl:5',
        { kind: 'unavailable', reason: 'missing' },
      ],
    ]);
    const out = composeHtmlDiff(hunked, snippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
      context: 3,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'source-file-unavailable.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('record with no line (file-only): byte-identical to fixture', async () => {
    const left = ``;
    const right = `<${EX}Foo> <${EX}label> "v2" .\n`;
    const hunked = await buildHunked(left, right);
    hunked.added[0].sourceRecords = {
      left: [],
      right: [{ file: 'file:///cwd/foo.jsonld' }],
    };
    const out = composeHtmlDiff(hunked, emptySnippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'line-not-available.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('overflow: hunk with more than 20 changed lines collapses body in <details>: byte-identical to fixture', async () => {
    const lines = Array.from({ length: 21 }, (_, i) => i + 1);
    const left = lines
      .map((i) => `<${EX}Foo> <${EX}p${i}> "v1-${i}" .\n`)
      .join('');
    const right = lines
      .map((i) => `<${EX}Foo> <${EX}p${i}> "v2-${i}" .\n`)
      .join('');
    const hunked = await buildHunked(left, right);
    const out = composeHtmlDiff(hunked, emptySnippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'overflow-21-lines.html'),
      out,
    );
    expect(out).toBe(golden);
  });

  it('orphan bnode tree (left-only): byte-identical to fixture', async () => {
    const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
    const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
    const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
    const left =
      `_:l <${RDF_FIRST}> <${EX}a> .\n` +
      `_:l <${RDF_REST}> <${RDF_NIL}> .\n`;
    const right = ``;
    const hunked = await buildHunked(left, right);
    const out = composeHtmlDiff(hunked, emptySnippets, {
      cwd: '/cwd',
      prefixes: PREFIXES,
    });
    const golden = await readOrWrite(
      join(FIXTURES, 'orphan-bnode-removed.html'),
      out,
    );
    expect(out).toBe(golden);
  });
});
