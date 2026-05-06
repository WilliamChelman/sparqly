import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, makeFileLoader } from './file-loader';

describe('makeFileLoader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses YAML into a project-config data bag', async () => {
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(path, 'sources:\n  - data/**/*.ttl\n');

    const load = makeFileLoader();
    const result = await load(path, dir);

    expect(result).toEqual({
      data: { sources: ['data/**/*.ttl'] },
      filepath: path,
    });
  });

  it('parses JSON when extension is .json', async () => {
    const path = join(dir, 'sparqly.config.json');
    await writeFile(path, JSON.stringify({ serve: { port: 8080 } }));

    const load = makeFileLoader();
    const result = await load(path, dir);

    expect(result.data).toEqual({ serve: { port: 8080 } });
    expect(result.filepath).toBe(path);
  });

  it('rejects unknown top-level keys (strict)', async () => {
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(path, 'sources:\n  - x\nbogus: 1\n');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
    await expect(load(path, dir)).rejects.toThrow(/bogus/);
  });

  it('reports type mismatches with the file path', async () => {
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(path, 'serve:\n  port: "abc"\n');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toThrow(path);
    await expect(load(path, dir)).rejects.toThrow(/port/);
  });

  it('hard-errors on a missing file', async () => {
    const path = join(dir, 'does-not-exist.yaml');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
    await expect(load(path, dir)).rejects.toThrow(path);
  });

  it('hard-errors on malformed YAML', async () => {
    const path = join(dir, 'broken.yaml');
    await writeFile(path, 'sources: "unterminated\n');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toBeInstanceOf(ConfigError);
  });

  it('rejects unsupported extensions', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, 'sources = "x"\n');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toThrow(/unsupported extension/);
  });

  it('rejects an array root with a clear message', async () => {
    const path = join(dir, 'arr.yaml');
    await writeFile(path, '- 1\n- 2\n');

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toThrow(/array/);
  });

  it('resolves relative paths against cwd', async () => {
    await writeFile(join(dir, 'rel.yaml'), 'sources:\n  - x\n');

    const load = makeFileLoader();
    const result = await load('rel.yaml', dir);
    expect(result.filepath).toBe(join(dir, 'rel.yaml'));
  });
});

describe('makeFileLoader — env-var substitution on sources[]', () => {
  let dir: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-env-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
  });

  it('expands ${VAR} from process.env in sources[] entries before Zod validation', async () => {
    process.env.SPARQLY_TEST_HOST = 'live.example.com';
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(
      path,
      'sources:\n  - "https://${SPARQLY_TEST_HOST}/sparql"\n',
    );

    const load = makeFileLoader();
    const result = await load(path, dir);
    expect(result.data).toEqual({
      sources: ['https://live.example.com/sparql'],
    });
  });

  it('fails the load when a sources[] entry references a missing env var, naming the var and JSON pointer', async () => {
    delete process.env.SPARQLY_MISSING_VAR;
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(
      path,
      'sources:\n  - "https://${SPARQLY_MISSING_VAR}/sparql"\n',
    );

    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toThrow(
      /SPARQLY_MISSING_VAR.*\/sources\/0/,
    );
  });

  it('${VAR} substitution composes with the whole-project schema', async () => {
    process.env.SPARQLY_TEST_HOST = 'live.example.com';
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(
      path,
      [
        'sources:',
        '  - "https://${SPARQLY_TEST_HOST}/sparql"',
        'serve:',
        '  port: 4000',
        '',
      ].join('\n'),
    );
    const load = makeFileLoader();
    const result = await load(path, dir);
    expect(result.data).toEqual({
      sources: ['https://live.example.com/sparql'],
      serve: { port: 4000 },
    });
  });
});

describe('makeFileLoader — whole-project schema', () => {
  let dir: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-loader-whole-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.env = { ...ORIGINAL_ENV };
  });

  it('accepts a valid whole-project config (sources + serve + format + cache) and returns blocks intact', async () => {
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(
      path,
      [
        'sources:',
        '  - id: fedlex',
        '    endpoint: https://fedlex.data.admin.ch/sparqlendpoint',
        'serve:',
        '  port: 3000',
        '  mutable: false',
        '  watch: true',
        '  watchDebounce: 250',
        '  watchPoll: 1000',
        'format:',
        '  prefixes:',
        '    ex: http://example.org/',
        '  base: http://example.org/',
        '  objectAnchoredPredicates:',
        '    - rdfs:label',
        'cache:',
        '  dir: .sparqly-cache',
        '',
      ].join('\n'),
    );

    const load = makeFileLoader();
    const result = await load(path, dir);
    expect(result.data).toEqual({
      sources: [
        { id: 'fedlex', endpoint: 'https://fedlex.data.admin.ch/sparqlendpoint' },
      ],
      serve: {
        port: 3000,
        mutable: false,
        watch: true,
        watchDebounce: 250,
        watchPoll: 1000,
      },
      format: {
        prefixes: { ex: 'http://example.org/' },
        base: 'http://example.org/',
        objectAnchoredPredicates: ['rdfs:label'],
      },
      cache: { dir: join(dir, '.sparqly-cache') },
    });
    expect(result.filepath).toBe(path);
  });

  it.each([
    ['out', 'out: ./report.txt'],
    ['query', 'query: SELECT * WHERE { ?s ?p ?o }'],
    ['format', 'format: turtle'],
    ['write', 'write: true'],
    ['check', 'check: true'],
    ['compareWith', 'compareWith: data/**/*.ttl'],
    ['left', 'left: data/a.ttl'],
    ['right', 'right: data/b.ttl'],
    ['context', 'context: 5'],
    ['skipAutoSourceAnnotation', 'skipAutoSourceAnnotation: true'],
    ['json', 'json: true'],
  ])(
    'rejects per-invocation key %s at root with a "per-invocation" message',
    async (key, line) => {
      const path = join(dir, 'sparqly.config.yaml');
      await writeFile(path, `${line}\n`);
      const load = makeFileLoader();
      await expect(load(path, dir)).rejects.toThrow(
        new RegExp(`${key}.*per-invocation`, 's'),
      );
    },
  );

  it.each([
    ['port', 'port: 3000', 'serve.port'],
    ['watch', 'watch: true', 'serve.watch'],
    ['watchDebounce', 'watchDebounce: 250', 'serve.watchDebounce'],
    ['watchPoll', 'watchPoll: 1000', 'serve.watchPoll'],
    ['mutable', 'mutable: false', 'serve.mutable'],
    ['prefixes', 'prefixes:\n  ex: http://example.org/', 'format.prefixes'],
    ['base', 'base: http://example.org/', 'format.base'],
    [
      'objectAnchoredPredicates',
      'objectAnchoredPredicates:\n  - rdfs:label',
      'format.objectAnchoredPredicates',
    ],
    ['cacheDir', 'cacheDir: .cache', 'cache.dir'],
  ])(
    'rejects misplaced root key %s, naming destination %s',
    async (key, line, destination) => {
      const path = join(dir, 'sparqly.config.yaml');
      await writeFile(path, `${line}\n`);
      const load = makeFileLoader();
      await expect(load(path, dir)).rejects.toThrow(
        new RegExp(
          `${key}.*move to ${destination.replace('.', '\\.')}`,
          's',
        ),
      );
    },
  );

  it('rejects unknown keys inside a block (strict)', async () => {
    const path = join(dir, 'sparqly.config.yaml');
    await writeFile(path, 'serve:\n  bogus: 1\n');
    const load = makeFileLoader();
    await expect(load(path, dir)).rejects.toThrow(/bogus/);
  });
});
