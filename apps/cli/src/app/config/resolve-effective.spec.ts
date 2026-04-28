import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readEnv } from './env-config';
import { ConfigError, resolveConfig } from './resolve-config';
import { resolveEffective } from './resolve-effective';

describe('full precedence chain', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-precedence-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function loadFile(): ReturnType<typeof resolveConfig> {
    return resolveConfig({ cwd: dir, stopDir: dir });
  }

  it('returns nothing when no source supplies a value', async () => {
    const resolved = await loadFile();
    const env = readEnv('serve', {});
    const effective = resolveEffective({
      command: 'serve',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(effective).toEqual({});
  });

  it('file shared sets a default that command-specific block overrides', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      [
        'sources: "shared/**/*.ttl"',
        'graphStrategy: default',
        'serve:',
        '  graphStrategy: full',
        '',
      ].join('\n'),
    );
    const resolved = await loadFile();
    const env = readEnv('serve', {});

    const serveEff = resolveEffective({
      command: 'serve',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(serveEff.graphStrategy).toBe('full');
    expect(serveEff.sources).toBe('shared/**/*.ttl');

    const queryResolved = resolved;
    const queryEnv = readEnv('query', {});
    const queryEff = resolveEffective({
      command: 'query',
      resolved: queryResolved,
      env: queryEnv,
      cliOverrides: {},
    });
    expect(queryEff.graphStrategy).toBe('default');
  });

  it('env overrides file (shared and command-specific)', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      [
        'sources: "from-file/**/*.ttl"',
        'serve:',
        '  port: 8080',
        '',
      ].join('\n'),
    );
    const resolved = await loadFile();
    const env = readEnv('serve', {
      SPARQLY_SOURCES: 'from-env/**/*.ttl',
      SPARQLY_SERVE_PORT: '9090',
    });

    const effective = resolveEffective({
      command: 'serve',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(effective.sources).toBe('from-env/**/*.ttl');
    expect(effective.port).toBe(9090);
  });

  it('CLI flags override env vars', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'serve:\n  port: 8080\n',
    );
    const resolved = await loadFile();
    const env = readEnv('serve', { SPARQLY_SERVE_PORT: '9090' });

    const effective = resolveEffective({
      command: 'serve',
      resolved,
      env,
      cliOverrides: { port: 4000 },
    });
    expect(effective.port).toBe(4000);
  });

  it('positional sources overrides file/env but is overridden by --sources', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'sources: "from-file/**/*.ttl"\n',
    );
    const resolved = await loadFile();
    const env = readEnv('query', { SPARQLY_SOURCES: 'from-env/**/*.ttl' });

    const positionalOnly = resolveEffective({
      command: 'query',
      resolved,
      env,
      cliOverrides: {},
      positionalSources: 'from-positional/**/*.ttl',
    });
    expect(positionalOnly.sources).toBe('from-positional/**/*.ttl');

    const flagWins = resolveEffective({
      command: 'query',
      resolved,
      env,
      cliOverrides: { sources: 'from-flag/**/*.ttl' },
      positionalSources: 'from-positional/**/*.ttl',
    });
    expect(flagWins.sources).toBe('from-flag/**/*.ttl');
  });

  it('command-namespaced env overrides shared env within the env tier', async () => {
    const resolved = await loadFile();
    const env = readEnv('serve', {
      SPARQLY_SOURCES: 'shared-env/**/*.ttl',
      SPARQLY_SERVE_SOURCES: 'serve-env/**/*.ttl',
    });
    const effective = resolveEffective({
      command: 'serve',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(effective.sources).toBe('serve-env/**/*.ttl');
  });

  it('falls back through the chain to defaults when no override is set', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'mutable: true\n',
    );
    const resolved = await loadFile();
    const env = readEnv('query', {});

    const effective = resolveEffective({
      command: 'query',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(effective.mutable).toBe(true);
  });

  it('command block overrides shared block for booleans', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      ['mutable: true', 'query:', '  mutable: false', ''].join('\n'),
    );
    const resolved = await loadFile();
    const env = readEnv('query', {});

    const effective = resolveEffective({
      command: 'query',
      resolved,
      env,
      cliOverrides: {},
    });
    expect(effective.mutable).toBe(false);
  });
});

describe('env-var coercion', () => {
  it('coerces SPARQLY_SERVE_PORT="3000" to the number 3000', () => {
    const env = readEnv('serve', { SPARQLY_SERVE_PORT: '3000' });
    expect(env.port).toBe(3000);
  });

  it('coerces SPARQLY_MUTABLE="true" / "false" to booleans', () => {
    expect(readEnv('query', { SPARQLY_MUTABLE: 'true' }).mutable).toBe(true);
    expect(readEnv('query', { SPARQLY_MUTABLE: 'false' }).mutable).toBe(false);
  });

  it('coerces SPARQLY_SERVE_WATCH="1" / "0" to booleans', () => {
    expect(readEnv('serve', { SPARQLY_SERVE_WATCH: '1' }).watch).toBe(true);
    expect(readEnv('serve', { SPARQLY_SERVE_WATCH: '0' }).watch).toBe(false);
  });

  it('coerces SPARQLY_SERVE_WATCH_DEBOUNCE="250" to a number', () => {
    expect(
      readEnv('serve', { SPARQLY_SERVE_WATCH_DEBOUNCE: '250' }).watchDebounce,
    ).toBe(250);
  });

  it('throws ConfigError when SPARQLY_SERVE_PORT is not numeric', () => {
    expect(() => readEnv('serve', { SPARQLY_SERVE_PORT: 'abc' })).toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError when SPARQLY_GRAPH_STRATEGY is invalid', () => {
    expect(() => readEnv('query', { SPARQLY_GRAPH_STRATEGY: 'bogus' })).toThrow(
      ConfigError,
    );
  });

  it('passes through SPARQLY_QUERY_FORMAT="turtle" as the typed enum', () => {
    expect(readEnv('query', { SPARQLY_QUERY_FORMAT: 'turtle' }).format).toBe(
      'turtle',
    );
  });

  it('ignores unrelated env vars', () => {
    expect(readEnv('serve', { PATH: '/usr/bin', NODE_ENV: 'test' })).toEqual(
      {},
    );
  });
});
