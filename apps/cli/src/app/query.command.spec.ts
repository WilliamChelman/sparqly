import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { QueryCommand } from './query.command';

describe('QueryCommand.run', () => {
  let dir: string;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-cli-'));
    stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(QueryCommand.prototype, 'readStdin').mockResolvedValue(null);
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  function joinCalls(spy: MockInstance<typeof process.stdout.write>): string {
    return spy.mock.calls
      .map((args) => {
        const chunk = (args as unknown[])[0] as string | Buffer | undefined;
        if (chunk == null) return '';
        return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      })
      .join('');
  }

  const stdoutText = (): string => joinCalls(stdout);
  const stderrText = (): string => joinCalls(stderr);

  it('runs a SELECT against a glob and emits JSON results to stdout', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero when the glob matches no files', async () => {
    const cmd = new QueryCommand();
    await cmd.run([join(dir, 'nope-*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/no files/i);
  });

  it('exits non-zero on a parse error and names the file in stderr', async () => {
    const bad = join(dir, 'broken.ttl');
    await writeFile(bad, 'this is not valid turtle <<<');

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/broken\.ttl/);
  });

  it('reads the query from --query-file', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const queryPath = join(dir, 'q.rq');
    await writeFile(
      queryPath,
      'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      queryFile: queryPath,
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero when --query-file path does not exist', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      queryFile: join(dir, 'does-not-exist.rq'),
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/--query-file/);
  });

  it('reads the query from stdin when no -q/--query-file is given', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    vi.spyOn(cmd, 'readStdin').mockResolvedValue(
      'SELECT ?s ?o WHERE { ?s <http://example.org/p> ?o }',
    );

    await cmd.run([join(dir, '*.ttl')], { quiet: true });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.head.vars).toEqual(['s', 'o']);
    expect(parsed.results.bindings[0].s.value).toBe('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero when no query source is provided and stdin is a TTY', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();

    await cmd.run([join(dir, '*.ttl')], { quiet: true });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/query is required/i);
  });

  it('errors when -q and --query-file are both given', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const queryPath = join(dir, 'q.rq');
    await writeFile(queryPath, 'SELECT ?s WHERE { ?s ?p ?o }');

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      queryFile: queryPath,
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/only one query source/i);
  });

  it('errors when -q is given and stdin is also piped', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    vi.spyOn(cmd, 'readStdin').mockResolvedValue(
      'SELECT ?s WHERE { ?s ?p ?o }',
    );

    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/only one query source/i);
  });

  it('errors when --query-file is given and stdin is also piped', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );
    const queryPath = join(dir, 'q.rq');
    await writeFile(queryPath, 'SELECT ?s WHERE { ?s ?p ?o }');

    const cmd = new QueryCommand();
    vi.spyOn(cmd, 'readStdin').mockResolvedValue(
      'SELECT ?s WHERE { ?s ?p ?o }',
    );

    await cmd.run([join(dir, '*.ttl')], {
      queryFile: queryPath,
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/only one query source/i);
  });

  it('emits JSON results for an ASK query by default', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'ASK WHERE { ?s <http://example.org/p> ?o }',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.boolean).toBe(true);
    expect(process.exitCode).toBeFalsy();
  });

  it('emits Turtle for a CONSTRUCT query by default', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      quiet: true,
    });

    expect(stdoutText()).toContain('http://example.org/a');
    expect(stdoutText()).not.toMatch(/^\s*\{/);
    expect(process.exitCode).toBeFalsy();
  });

  it('emits Turtle for a DESCRIBE query by default', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'DESCRIBE <http://example.org/a>',
      quiet: true,
    });

    expect(stdoutText()).toContain('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('honours --format=turtle on a CONSTRUCT query', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      format: 'turtle',
      quiet: true,
    });

    expect(stdoutText()).toContain('http://example.org/a');
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero when --format=turtle is used with a SELECT query', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      format: 'turtle',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/turtle/i);
  });

  it('exits non-zero when --format=json is used with a CONSTRUCT query', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      format: 'json',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/json/i);
  });

  it('exits non-zero on an unknown --format value', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      format: 'csv',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/unknown.*--format|--format.*unknown/i);
  });

  it('default: triple-format files yield no GRAPH ?g bindings', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.results.bindings).toHaveLength(0);
    expect(process.exitCode).toBeFalsy();
  });

  it('--graph-strategy=partial: GRAPH ?g binds the file:// graph for triple-format files', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      graphStrategy: 'partial',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.results.bindings).toHaveLength(1);
    expect(parsed.results.bindings[0].g.value).toBe(`file://${file}`);
    expect(process.exitCode).toBeFalsy();
  });

  it('--graph-strategy=full: GRAPH ?g binds the file:// graph for triple-format files', async () => {
    const file = join(dir, 'data.ttl');
    await writeFile(
      file,
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?g WHERE { GRAPH ?g { ?s ?p ?o } }',
      graphStrategy: 'full',
      quiet: true,
    });

    const parsed = JSON.parse(stdoutText());
    expect(parsed.results.bindings).toHaveLength(1);
    expect(parsed.results.bindings[0].g.value).toBe(`file://${file}`);
    expect(process.exitCode).toBeFalsy();
  });

  it('exits non-zero on an unknown --graph-strategy value', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p ?o }',
      graphStrategy: 'bogus',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText()).toMatch(/unknown.*--graph-strategy/i);
  });

  describe('immutability guard', () => {
    const updateQuery =
      'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }';

    it('rejects an UPDATE query by default with a non-zero exit and message naming the opt-in flags', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      const cmd = new QueryCommand();
      await cmd.run([join(dir, '*.ttl')], {
        query: updateQuery,
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(
        /Mutating queries.*--mutable.*--immutable=false/,
      );
    });

    for (const verb of ['INSERT DATA', 'DELETE DATA', 'LOAD']) {
      const queryByVerb: Record<string, string> = {
        'INSERT DATA':
          'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
        'DELETE DATA':
          'DELETE DATA { <http://example.org/a> <http://example.org/p> <http://example.org/b> }',
        LOAD: 'LOAD <http://example.org/data.ttl>',
      };

      it(`rejects ${verb} by default`, async () => {
        await writeFile(
          join(dir, 'data.ttl'),
          '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
        );

        const cmd = new QueryCommand();
        await cmd.run([join(dir, '*.ttl')], {
          query: queryByVerb[verb],
          quiet: true,
        });

        expect(process.exitCode).toBe(1);
        expect(stderrText()).toMatch(/Mutating queries are disabled/);
      });
    }

    it('lets the query reach execution when --mutable is passed (distinct not-implemented error)', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      const cmd = new QueryCommand();
      await cmd.run([join(dir, '*.ttl')], {
        query: updateQuery,
        mutable: true,
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/not yet implemented/i);
      expect(stderrText()).not.toMatch(/Mutating queries are disabled/);
    });

    it('lets the query reach execution when --immutable=false is passed', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      const cmd = new QueryCommand();
      await cmd.run([join(dir, '*.ttl')], {
        query: updateQuery,
        immutable: false,
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/not yet implemented/i);
      expect(stderrText()).not.toMatch(/Mutating queries are disabled/);
    });

    it('SELECT/ASK/CONSTRUCT/DESCRIBE always pass the guard regardless of the flag', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );

      for (const query of [
        'SELECT ?s WHERE { ?s ?p ?o }',
        'ASK WHERE { ?s ?p ?o }',
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        'DESCRIBE <http://example.org/a>',
      ]) {
        process.exitCode = undefined;
        stdout.mockClear();
        stderr.mockClear();

        const cmd = new QueryCommand();
        await cmd.run([join(dir, '*.ttl')], { query, quiet: true });
        expect(process.exitCode).toBeFalsy();
      }
    });
  });

  describe('config file integration', () => {
    it('uses sources from --config when no CLI override is given', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      const configPath = join(dir, 'sparqly.config.yaml');
      await writeFile(configPath, `sources: "${join(dir, '*.ttl')}"\n`);

      const cmd = new QueryCommand();
      await cmd.run([], {
        query: 'SELECT ?s WHERE { ?s ?p ?o }',
        config: configPath,
        quiet: true,
      });

      const parsed = JSON.parse(stdoutText());
      expect(parsed.results.bindings).toHaveLength(1);
      expect(process.exitCode).toBeFalsy();
    });

    it('logs the discovered config path under --verbose', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      const configPath = join(dir, 'sparqly.config.json');
      await writeFile(
        configPath,
        JSON.stringify({ sources: join(dir, '*.ttl') }),
      );

      const cmd = new QueryCommand();
      await cmd.run([], {
        query: 'SELECT ?s WHERE { ?s ?p ?o }',
        config: configPath,
        verbose: true,
      });

      expect(stderrText()).toContain(configPath);
      expect(stderrText()).toMatch(/Loaded config from/);
      expect(process.exitCode).toBeFalsy();
    });

    it('hard-errors when --config path does not exist', async () => {
      const cmd = new QueryCommand();
      await cmd.run([], {
        query: 'SELECT ?s WHERE { ?s ?p ?o }',
        config: join(dir, 'missing.yaml'),
        quiet: true,
      });

      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/missing\.yaml/);
    });

    it('CLI --mutable overrides mutable: false from the config file', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      const configPath = join(dir, 'sparqly.config.json');
      await writeFile(configPath, JSON.stringify({ mutable: false }));

      const cmd = new QueryCommand();
      await cmd.run([join(dir, '*.ttl')], {
        query:
          'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
        mutable: true,
        config: configPath,
        quiet: true,
      });

      expect(stderrText()).toMatch(/not yet implemented/i);
      expect(stderrText()).not.toMatch(/Mutating queries are disabled/);
    });

    it('config mutable: true lets a mutating query reach execution when no CLI flag is set', async () => {
      await writeFile(
        join(dir, 'data.ttl'),
        '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
      );
      const configPath = join(dir, 'sparqly.config.json');
      await writeFile(configPath, JSON.stringify({ mutable: true }));

      const cmd = new QueryCommand();
      await cmd.run([join(dir, '*.ttl')], {
        query:
          'INSERT DATA { <http://example.org/x> <http://example.org/p> <http://example.org/y> }',
        config: configPath,
        quiet: true,
      });

      expect(stderrText()).toMatch(/not yet implemented/i);
      expect(stderrText()).not.toMatch(/Mutating queries are disabled/);
    });
  });

  it('exits non-zero on a query error', async () => {
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .',
    );

    const cmd = new QueryCommand();
    await cmd.run([join(dir, '*.ttl')], {
      query: 'SELECT ?s WHERE { ?s ?p',
      quiet: true,
    });

    expect(process.exitCode).toBe(1);
    expect(stderrText().length).toBeGreaterThan(0);
  });
});
