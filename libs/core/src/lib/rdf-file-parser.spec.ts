import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRdfFile } from './rdf-file-parser';

describe('parseRdfFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-parser-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits one record with line=1 for a single-line turtle triple', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(1);
    expect(records[0].quad.predicate.value).toBe('http://example.org/p');
    expect(records[0].line).toBe(1);
  });

  it('emits distinct lines per (p, o) pair in a multi-line subject block', async () => {
    const file = join(dir, 'multi.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .

        ex:a ex:p1 ex:o1 ;
          ex:p2 ex:o2 ;
          ex:p3 ex:o3 .
      ` + '\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(3);
    const linesByPredicate = Object.fromEntries(
      records.map((r) => [r.quad.predicate.value, r.line]),
    );
    expect(linesByPredicate['http://example.org/p1']).toBe(3);
    expect(linesByPredicate['http://example.org/p2']).toBe(4);
    expect(linesByPredicate['http://example.org/p3']).toBe(5);
  });

  it('emits per-line records for N-Triples files', async () => {
    const file = join(dir, 'a.nt');
    await writeFile(
      file,
      dedent`
        <http://example.org/a> <http://example.org/p1> <http://example.org/b> .
        <http://example.org/c> <http://example.org/p2> <http://example.org/d> .
      ` + '\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(2);
    expect(records[0].quad.predicate.value).toBe('http://example.org/p1');
    expect(records[0].line).toBe(1);
    expect(records[1].quad.predicate.value).toBe('http://example.org/p2');
    expect(records[1].line).toBe(2);
  });

  it('emits per-line records for N-Quads files preserving the graph term', async () => {
    const file = join(dir, 'a.nq');
    await writeFile(
      file,
      dedent`
        <http://example.org/a> <http://example.org/p1> <http://example.org/b> <http://example.org/g> .
        <http://example.org/c> <http://example.org/p2> <http://example.org/d> .
      ` + '\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(2);
    expect(records[0].line).toBe(1);
    expect(records[0].quad.graph.value).toBe('http://example.org/g');
    expect(records[1].line).toBe(2);
    expect(records[1].quad.graph.termType).toBe('DefaultGraph');
  });

  it('emits per-line records inside a TriG named graph block', async () => {
    const file = join(dir, 'a.trig');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:g {
          ex:a ex:p1 ex:o1 ;
            ex:p2 ex:o2 .
        }
      ` + '\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(2);
    expect(records[0].quad.predicate.value).toBe('http://example.org/p1');
    expect(records[0].line).toBe(3);
    expect(records[0].quad.graph.value).toBe('http://example.org/g');
    expect(records[1].quad.predicate.value).toBe('http://example.org/p2');
    expect(records[1].line).toBe(4);
    expect(records[1].quad.graph.value).toBe('http://example.org/g');
  });

  it('emits records with line=undefined for JSON-LD files', async () => {
    const file = join(dir, 'a.jsonld');
    await writeFile(
      file,
      JSON.stringify({
        '@context': { ex: 'http://example.org/' },
        '@id': 'ex:a',
        'ex:p': { '@id': 'ex:b' },
      }),
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(1);
    expect(records[0].quad).toBeDefined();
    expect(records[0].quad.predicate.value).toBe('http://example.org/p');
    expect(records[0].line).toBeUndefined();
  });

  it('emits records with line=undefined for RDF/XML files', async () => {
    const file = join(dir, 'a.rdf');
    await writeFile(
      file,
      dedent`
        <?xml version="1.0"?>
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:ex="http://example.org/">
          <rdf:Description rdf:about="http://example.org/a">
            <ex:p rdf:resource="http://example.org/b"/>
          </rdf:Description>
        </rdf:RDF>
      ` + '\n',
    );
    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(1);
    expect(records[0].quad.predicate.value).toBe('http://example.org/p');
    expect(records[0].line).toBeUndefined();
  });

  it('captures prefixes declared in turtle source', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix dct: <http://purl.org/dc/terms/> .
        ex:a ex:p ex:b .
      `,
    );
    const { prefixes } = await parseRdfFile(file);
    expect(prefixes).toEqual({
      ex: 'http://example.org/',
      dct: 'http://purl.org/dc/terms/',
    });
  });

  it('throws on unsupported file extensions', async () => {
    const file = join(dir, 'a.unknown');
    await writeFile(file, 'irrelevant');
    await expect(parseRdfFile(file)).rejects.toThrow(/unsupported file extension/i);
  });

  it('streams large N-Quads files preserving line numbers across chunk boundaries', async () => {
    const file = join(dir, 'large.nq');
    // ~6 MB: fits comfortably in memory but well past a single fs read chunk
    // (default 64 KB), so the lexer must accumulate `_line` across many chunks.
    const totalLines = 100_000;
    const handle = await import('node:fs/promises').then((m) => m.open(file, 'w'));
    try {
      const batchSize = 5_000;
      for (let start = 0; start < totalLines; start += batchSize) {
        let buf = '';
        for (let i = 0; i < batchSize && start + i < totalLines; i++) {
          const n = start + i + 1;
          buf += `<http://example.org/s${n}> <http://example.org/p> <http://example.org/o${n}> <http://example.org/g> .\n`;
        }
        await handle.write(buf);
      }
    } finally {
      await handle.close();
    }

    const { records } = await parseRdfFile(file);
    expect(records).toHaveLength(totalLines);
    expect(records[0].quad.subject.value).toBe('http://example.org/s1');
    expect(records[0].line).toBe(1);
    const midIndex = Math.floor(totalLines / 2);
    expect(records[midIndex].quad.subject.value).toBe(`http://example.org/s${midIndex + 1}`);
    expect(records[midIndex].line).toBe(midIndex + 1);
    expect(records[totalLines - 1].quad.subject.value).toBe(`http://example.org/s${totalLines}`);
    expect(records[totalLines - 1].line).toBe(totalLines);
  });
});
