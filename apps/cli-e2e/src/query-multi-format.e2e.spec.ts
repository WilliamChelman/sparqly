import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const FORMATS_GLOB = queryFixture('formats', '*');

const TRIPLE_FORMATS = ['Turtle', 'N-Triples', 'JSON-LD', 'RDF/XML'] as const;
const QUAD_FORMATS = ['N-Quads', 'TriG'] as const;

describe('sparqly query — multi-format loading', () => {
  it('loads triples from all triple-format files into the default graph (US 9)', async () => {
    const result = await runCli([
      'query',
      FORMATS_GLOB,
      '-q',
      'SELECT ?fmt WHERE { ?s <http://example.org/format> ?fmt }',
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    const fmts = json.results.bindings.map(
      (b: { fmt: { value: string } }) => b.fmt.value,
    );
    for (const expected of TRIPLE_FORMATS) {
      expect(fmts).toContain(expected);
    }
  });

  it('GRAPH ?g returns triples from quad-format files (US 10, 11)', async () => {
    const result = await runCli([
      'query',
      FORMATS_GLOB,
      '-q',
      'SELECT ?fmt WHERE { GRAPH ?g { ?s <http://example.org/format> ?fmt } }',
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    const fmts = json.results.bindings.map(
      (b: { fmt: { value: string } }) => b.fmt.value,
    );
    for (const expected of QUAD_FORMATS) {
      expect(fmts).toContain(expected);
    }
  });

  it('--graph-strategy full puts every file in its own file:// graph (US 12)', async () => {
    const result = await runCli([
      'query',
      FORMATS_GLOB,
      '--graph-strategy',
      'full',
      '-q',
      'SELECT DISTINCT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
    ]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    const graphs = json.results.bindings.map(
      (b: { g: { value: string } }) => b.g.value,
    );
    expect(graphs).toHaveLength(6);
    for (const g of graphs) {
      expect(g).toMatch(/^file:\/\//);
    }
  });

  describe('parse error reporting', () => {
    let scratch: string;

    beforeEach(async () => {
      scratch = await mkdtemp(join(tmpdir(), 'sparqly-parse-'));
    });

    afterEach(async () => {
      await rm(scratch, { recursive: true, force: true });
    });

    it('reports the offending file path on a parse error and exits non-zero', async () => {
      const goodPath = join(scratch, 'good.ttl');
      const badPath = join(scratch, 'bad.ttl');
      await copyFile(queryFixture('formats', 'sample.ttl'), goodPath);
      await writeFile(badPath, 'this is not turtle <<< parse failure\n');

      const result = await runCli([
        'query',
        join(scratch, '*.ttl'),
        '-q',
        'SELECT * WHERE { ?s ?p ?o }',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/Failed to parse/);
      expect(result.stderr).toContain(badPath);
    });
  });
});
