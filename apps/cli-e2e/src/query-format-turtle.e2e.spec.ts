import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { leadingHash } from './helpers/hash';

describe('sparqly query --format=turtle (formatter integration)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-query-turtle-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('formatter pass preserves the graph: RDFC-1.0 hash matches the source', async () => {
    const data = join(dir, 'data.ttl');
    await writeFile(
      data,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" ; ex:age 30 .
        ex:bob ex:knows ex:alice ; ex:name "Bob" .
        ex:list ex:items ( "a" "b" "c" ) .
      ` + '\n',
    );

    const formatted = join(dir, 'formatted.ttl');
    const queryRun = await runCli([
      'query',
      data,
      '--format=turtle',
      '-q',
      dedent`
        PREFIX ex: <http://example.org/>
        CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }
      `,
      '-o',
      formatted,
    ]);
    expect(queryRun.exitCode).toBe(0);

    const [sourceHash, formattedHash] = await Promise.all([
      runCli(['hash', '--quiet', data]),
      runCli(['hash', '--quiet', formatted]),
    ]);
    expect(sourceHash.exitCode).toBe(0);
    expect(formattedHash.exitCode).toBe(0);
    expect(leadingHash(formattedHash.stdout)).toBe(
      leadingHash(sourceHash.stdout),
    );
  });

  it('prefers the query string PREFIX when it conflicts with config', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://config.example/"
      ` + '\n',
    );
    const data = join(dir, 'data.ttl');
    await writeFile(
      data,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        data,
        '--format=turtle',
        '-q',
        dedent`
          PREFIX ex: <http://example.org/>
          CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }
        `,
      ],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(0);
    // Query's `ex:` mapping wins; config's `http://config.example/` is dropped.
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).not.toContain('<http://config.example/>');
    expect(result.stdout).toContain('ex:alice ex:name "Alice"');
  });

  it('honours PREFIX declarations from the SPARQL query string', async () => {
    const data = join(dir, 'data.ttl');
    await writeFile(
      data,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
      ` + '\n',
    );

    const result = await runCli([
      'query',
      data,
      '--format=turtle',
      '-q',
      dedent`
        PREFIX ex: <http://example.org/>
        CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }
      `,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).toContain('ex:alice ex:name "Alice"');
    expect(result.stdout).not.toContain('<http://example.org/alice>');
  });

  it('runs Turtle output through the formatter using config prefixes', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      dedent`
        prefixes:
          ex: "http://example.org/"
      ` + '\n',
    );
    const data = join(dir, 'data.ttl');
    await writeFile(
      data,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:alice ex:name "Alice" .
      ` + '\n',
    );

    const result = await runCli(
      [
        'query',
        data,
        '--format=turtle',
        '-q',
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      ],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@prefix ex: <http://example.org/>');
    expect(result.stdout).toContain('ex:alice ex:name "Alice"');
    expect(result.stdout).not.toContain('<http://example.org/alice>');
  });
});
