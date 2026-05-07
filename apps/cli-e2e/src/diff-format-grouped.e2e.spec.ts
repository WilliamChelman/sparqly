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

  it('buckets hunks into changed → removed → added sections with `(removed)` / `(added)` markers and lex sort within each', async () => {
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
      'ex:Foo  (sh:NodeShape)  [-1 +1]',
      '- rdfs:label "Foo v1" .',
      '+ rdfs:label "Foo v2" .',
      'ex:Bar  (sh:NodeShape)  (removed)  [-2 +0]',
      '- a sh:NodeShape .',
      '- rdfs:label "Bar v1" .',
      'ex:Baz  (sh:NodeShape)  (added)  [-0 +2]',
      '+ a sh:NodeShape .',
      '+ rdfs:label "Baz v1" .',
    ]);
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
