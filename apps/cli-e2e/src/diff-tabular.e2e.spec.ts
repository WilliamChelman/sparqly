import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';
import { runCli } from './helpers/run-cli';

const TTL_HEADER = '@prefix ex: <http://example.org/> .';

describe('sparqly diff — tabular mode (arbitrary SELECT)', () => {
  let scratch: string;
  let leftPath: string;
  let rightPath: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-diff-tabular-'));
    leftPath = join(scratch, 'left.ttl');
    rightPath = join(scratch, 'right.ttl');
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('exits 0 with empty stdout when both sides project equal bindings', async () => {
    await writeFile(
      leftPath,
      [
        TTL_HEADER,
        'ex:p1 ex:id "1" ; ex:status "open" .',
        'ex:p2 ex:id "2" ; ex:status "closed" .',
      ].join('\n'),
    );
    await writeFile(
      rightPath,
      [
        TTL_HEADER,
        'ex:p1 ex:id "1" ; ex:status "open" .',
        'ex:p2 ex:id "2" ; ex:status "closed" .',
      ].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id ?status WHERE { ?p ex:id ?id ; ex:status ?status }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe('# left=2 right=2 +0 -0\n');
  });

  it('exits 1, surfaces an added row, and reports `# +1 -0` on stderr when right has an extra row (multi-var human format)', async () => {
    await writeFile(
      leftPath,
      [TTL_HEADER, 'ex:p1 ex:id "1" ; ex:status "open" .'].join('\n'),
    );
    await writeFile(
      rightPath,
      [
        TTL_HEADER,
        'ex:p1 ex:id "1" ; ex:status "open" .',
        'ex:p2 ex:id "2" ; ex:status "closed" .',
      ].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id ?status WHERE { ?p ex:id ?id ; ex:status ?status }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      '# left=1 right=2 +1 -0\n+ {?id="2", ?status="closed"}\n',
    );
    expect(result.stderr).toBe('# left=1 right=2 +1 -0\n');
  });

  it('surfaces net count drift as (×N) in human format (3× left + 5× right → +2)', async () => {
    await writeFile(
      leftPath,
      [
        TTL_HEADER,
        'ex:p1 ex:status "open" .',
        'ex:p2 ex:status "open" .',
        'ex:p3 ex:status "open" .',
      ].join('\n'),
    );
    await writeFile(
      rightPath,
      [
        TTL_HEADER,
        'ex:p1 ex:status "open" .',
        'ex:p2 ex:status "open" .',
        'ex:p3 ex:status "open" .',
        'ex:p4 ex:status "open" .',
        'ex:p5 ex:status "open" .',
      ].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?status WHERE { ?p ex:status ?status }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      '# left=3 right=5 +1 -0\n+ {?status="open"} (×2)\n',
    );
  });

  it('emits a JSON envelope with added/removed/vars when -f json is requested', async () => {
    await writeFile(
      leftPath,
      [TTL_HEADER, 'ex:p1 ex:id "gone" .'].join('\n'),
    );
    await writeFile(
      rightPath,
      [TTL_HEADER, 'ex:p1 ex:id "new" .'].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '-f',
      'json',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.vars).toEqual(['id']);
    expect(parsed.removed).toHaveLength(1);
    expect(parsed.removed[0].row.id.value).toBe('gone');
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].row.id.value).toBe('new');
  });

  it('rejects pairing a triples-shape CONSTRUCT with a tuples-shape SELECT (mixed shape)', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:id ?id } WHERE { ?s ex:id ?id }',
      '--right-query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/mixed-shape|shape mismatch/i);
    expect(result.stderr).toMatch(/left/);
    expect(result.stderr).toMatch(/right/);
  });

  it('rejects pairing a tuples-shape SELECT with a triples-shape SELECT-spo (mixed shape)', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      '--right-query',
      'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/mixed-shape|shape mismatch/i);
  });

  it('rejects mismatched projected variable-name sets with a clear error', async () => {
    await writeFile(
      leftPath,
      [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'),
    );
    await writeFile(
      rightPath,
      [TTL_HEADER, 'ex:p1 ex:status "open" .'].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--left-query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      '--right-query',
      'PREFIX ex: <http://example.org/> SELECT ?status WHERE { ?p ex:status ?status }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/variable-name set/);
  });

  it('renders -f html as a self-contained doc with two tables and a count column (tabular fixture)', async () => {
    await writeFile(
      leftPath,
      [TTL_HEADER, 'ex:p1 ex:id "1" ; ex:status "open" .'].join('\n'),
    );
    await writeFile(
      rightPath,
      [
        TTL_HEADER,
        'ex:p1 ex:id "1" ; ex:status "open" .',
        'ex:p2 ex:id "2" ; ex:status "closed" .',
      ].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '-f',
      'html',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id ?status WHERE { ?p ex:id ?id ; ex:status ?status }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode, result.stderr).toBe(1);
    expect(result.stdout.startsWith('<!doctype html>')).toBe(true);
    expect(result.stdout).toContain('<style>');
    expect(result.stdout).not.toMatch(/<script\b/);
    expect(result.stdout).not.toMatch(/<link\b/);
    expect(result.stdout).toContain('<h1>sparqly diff</h1>');
    // exactly one added row, no removed
    expect(result.stdout).toContain('+1 −0');
    expect(result.stdout).toContain('<th>?id</th>');
    expect(result.stdout).toContain('<th>?status</th>');
    expect(result.stdout).toContain('<th>count</th>');
    expect(result.stdout).toContain('<td>&quot;2&quot;</td>');
    expect(result.stdout).toContain('<td>&quot;closed&quot;</td>');
    // removed block is empty
    expect(result.stdout).toMatch(
      /<section class="block removed">[\s\S]*?<p class="empty">\(none\)<\/p>[\s\S]*?<\/section>/,
    );
  });

  it('rejects a tabular row whose projection is bound to a blank node (no silent garbage)', async () => {
    await writeFile(
      leftPath,
      [
        TTL_HEADER,
        'ex:p1 ex:item _:b1 .',
        '_:b1 ex:val "x" .',
      ].join('\n'),
    );
    await writeFile(
      rightPath,
      [
        TTL_HEADER,
        'ex:p1 ex:item _:b2 .',
        '_:b2 ex:val "x" .',
      ].join('\n'),
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?item WHERE { ?p ex:item ?item }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/blank node/i);
    expect(result.stderr).toMatch(/\?item/);
  });

  it('rejects -f rdf-patch in tabular mode (RDF-shaped formats have no meaning for tuple results)', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '-f',
      'rdf-patch',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/rdf-patch/);
    expect(result.stderr).toMatch(/tuple/i);
  });

  it('rejects -f turtle in tabular mode (RDF-shaped formats have no meaning for tuple results)', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '-f',
      'turtle',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/turtle/);
    expect(result.stderr).toMatch(/tuple/i);
  });

  it('emits a stderr warning per side when LIMIT/OFFSET is used without ORDER BY', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id } LIMIT 10',
      leftPath,
      rightPath,
    ]);

    expect(result.stderr).toMatch(/left-side.*LIMIT\/OFFSET/);
    expect(result.stderr).toMatch(/right-side.*LIMIT\/OFFSET/);
  });

  describe('endpoint target via pass-through', () => {
    let endpoint: FakeSparqlEndpoint | undefined;

    afterEach(async () => {
      if (endpoint) await endpoint.close();
      endpoint = undefined;
    });

    it('dispatches the SELECT to a SPARQL endpoint target and surfaces the bindings drift, without locally materializing the endpoint', async () => {
      const captured: string[] = [];
      endpoint = await startFakeSparqlEndpoint(({ query }) => {
        captured.push(query);
        return {
          body: JSON.stringify({
            head: { vars: ['id', 'status'] },
            results: {
              bindings: [
                {
                  id: { type: 'literal', value: '1' },
                  status: { type: 'literal', value: 'open' },
                },
                {
                  id: { type: 'literal', value: '2' },
                  status: { type: 'literal', value: 'closed' },
                },
              ],
            },
          }),
        };
      });

      // Left side is a glob with one row matching the right side; right side
      // is the endpoint, which returns two rows. The added row should be the
      // one only the endpoint emitted.
      await writeFile(
        leftPath,
        [TTL_HEADER, 'ex:p1 ex:id "1" ; ex:status "open" .'].join('\n'),
      );

      const result = await runCli([
        'diff',
        '--quiet',
        '--query',
        'PREFIX ex: <http://example.org/> SELECT ?id ?status WHERE { ?p ex:id ?id ; ex:status ?status }',
        leftPath,
        endpoint.url,
      ]);

      expect(result.exitCode, result.stderr).toBe(1);
      expect(result.stdout).toBe(
        '# left=1 right=2 +1 -0\n+ {?id="2", ?status="closed"}\n',
      );

      // Endpoint must have been contacted — i.e., pass-through, not skipped
      // or locally materialized.
      expect(captured.length).toBeGreaterThan(0);
      // The query that hit the endpoint is the user's projection, not a
      // SELECT-spo materialization probe.
      expect(captured.some((q) => q.includes('?id') && q.includes('?status')))
        .toBe(true);
      expect(
        captured.every((q) => !/SELECT\s+\?s\s+\?p\s+\?o/i.test(q)),
      ).toBe(true);
    });
  });

  it('accepts --skip-auto-source-annotation in tabular mode (no-op)', async () => {
    await writeFile(leftPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));
    await writeFile(rightPath, [TTL_HEADER, 'ex:p1 ex:id "1" .'].join('\n'));

    const result = await runCli([
      'diff',
      '--quiet',
      '--skip-auto-source-annotation',
      '--query',
      'PREFIX ex: <http://example.org/> SELECT ?id WHERE { ?p ex:id ?id }',
      leftPath,
      rightPath,
    ]);

    expect(result.exitCode).toBe(0);
  });
});
