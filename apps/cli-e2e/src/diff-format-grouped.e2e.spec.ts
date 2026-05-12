import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffBodyLines } from './helpers/hash';

describe('sparqly diff -f grouped', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await realpath(
      await mkdtemp(join(tmpdir(), 'sparqly-diff-grouped-')),
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('groups changed triples under their named-entity anchor with paired -/+ for single-value flips, sharing prefix shortening with turtle/human', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        ex:Foo a sh:NodeShape ;
          rdfs:label "Foo v1" .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        ex:Foo a sh:NodeShape ;
          rdfs:label "Foo v2" .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=grouped', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toEqual([
      'ex:Foo  (sh:NodeShape)  [-1 +1]',
      '- rdfs:label "Foo v1" .',
      '+ rdfs:label "Foo v2" .',
    ]);
  });

  it('emits one anchor-sorted hunk list (interleaving changed/removed/added) with `(removed)` / `(added)` markers in single-side headers', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        ex:Foo a sh:NodeShape ;
          rdfs:label "Foo v1" .
        ex:Bar a sh:NodeShape ;
          rdfs:label "Bar v1" .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        ex:Foo a sh:NodeShape ;
          rdfs:label "Foo v2" .
        ex:Baz a sh:NodeShape ;
          rdfs:label "Baz v1" .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=grouped', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toEqual([
      'ex:Bar  (sh:NodeShape)  (removed)  [-2 +0]',
      '- a sh:NodeShape .',
      '- rdfs:label "Bar v1" .',
      'ex:Baz  (sh:NodeShape)  (added)  [-0 +2]',
      '+ a sh:NodeShape .',
      '+ rdfs:label "Baz v1" .',
      'ex:Foo  (sh:NodeShape)  [-1 +1]',
      '- rdfs:label "Foo v1" .',
      '+ rdfs:label "Foo v2" .',
    ]);
  });

  it('surfaces a bnode tree with no named-entity parent on either side as an `(orphan)`-marked hunk anchored on the canonical bnode label', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    // An RDF list head with no named subject pointing at it: an orphan tree.
    // Removed entirely on the right.
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        _:head rdf:first ex:a ;
          rdf:rest rdf:nil .
      ` + '\n',
    );
    await writeFile(rightPath, '');

    const result = await runCli(
      ['diff', '--quiet', '--format=grouped', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    // The header carries the `(orphan)` marker plus `(removed)` because the
    // tree is left-only. The anchor is the orphan root's canonical bnode
    // label, rendered with the `_:` prefix rather than as a CURIE.
    expect(lines[0]).toMatch(/^_:[^\s]+ {2}\(orphan\) {2}\(removed\) {2}\[-\d+ \+0\]$/);
  });

  it('absorbs an edited PropertyShape blank node into its parent NodeShape, pairing -/+ by sh:path identity with a [sh:path …] / predicate notation', async () => {
    const leftPath = join(scratch, 'left.ttl');
    const rightPath = join(scratch, 'right.ttl');
    await writeFile(
      leftPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        ex:Shape a sh:NodeShape ;
          sh:property [
            sh:path ex:foo ;
            sh:datatype xsd:decimal ;
          ] .
      ` + '\n',
    );
    await writeFile(
      rightPath,
      dedent`
        @prefix ex: <http://example.org/> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        ex:Shape a sh:NodeShape ;
          sh:property [
            sh:path ex:foo ;
            sh:datatype xsd:integer ;
          ] .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=grouped', leftPath, rightPath],
      { cwd: scratch },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    expect(lines).toEqual([
      'ex:Shape  (sh:NodeShape)  [-1 +1]',
      '- [sh:path ex:foo] / sh:datatype xsd:decimal .',
      '+ [sh:path ex:foo] / sh:datatype xsd:integer .',
    ]);
  });
});
