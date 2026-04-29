import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { loadConfig, runWithConfig } from './index';

function unwrap<T>(value: T | null): T {
  if (value === null) throw new Error('expected non-null value');
  return value;
}

class StringStream extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('loadConfig', () => {
  let dir: string;
  let stderr: MockInstance<typeof process.stderr.write>;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-config-'));
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    stderr.mockRestore();
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  const stderrText = (): string =>
    stderr.mock.calls
      .map((args) => {
        const c = (args as unknown[])[0] as string | Buffer | undefined;
        return c == null ? '' : typeof c === 'string' ? c : c.toString('utf8');
      })
      .join('');

  describe('precedence chain', () => {
    it('lets each tier (default → file → env → positional → flag) win for at least one key', async () => {
      await writeFile(
        join(dir, 'sparqly.config.yaml'),
        [
          'mutable: true',
          'serve:',
          '  port: 8080',
          '  watch: true',
          '',
        ].join('\n'),
      );

      const loaded = await loadConfig({
        command: 'serve',
        cliOverrides: { graphStrategy: 'partial' },
        positionalSources: 'pos/**/*.ttl',
        env: { SPARQLY_SERVE_WATCH_DEBOUNCE: '500' },
        cwd: dir,
      });

      expect(loaded).not.toBeNull();
      const eff = unwrap(loaded).effective;
      expect(eff.quiet).toBe(false);
      expect(eff.mutable).toBe(true);
      expect(eff.port).toBe(8080);
      expect(eff.watch).toBe(true);
      expect(eff.watchDebounce).toBe(500);
      expect(eff.sources).toBe('pos/**/*.ttl');
      expect(eff.graphStrategy).toBe('partial');
    });

    it('CLI flag beats positional sources', async () => {
      const loaded = await loadConfig({
        command: 'query',
        cliOverrides: { sources: 'flag/**/*.ttl' },
        positionalSources: 'pos/**/*.ttl',
        env: {},
        cwd: dir,
      });
      expect(unwrap(loaded).effective.sources).toBe('flag/**/*.ttl');
    });

    it('command-namespaced env beats shared env', async () => {
      const loaded = await loadConfig({
        command: 'serve',
        cliOverrides: {},
        env: {
          SPARQLY_SOURCES: 'shared/**/*.ttl',
          SPARQLY_SERVE_SOURCES: 'serve/**/*.ttl',
        },
        cwd: dir,
      });
      expect(unwrap(loaded).effective.sources).toBe('serve/**/*.ttl');
    });

    it('command block in the file overrides shared block', async () => {
      await writeFile(
        join(dir, 'sparqly.config.yaml'),
        ['mutable: true', 'query:', '  mutable: false', ''].join('\n'),
      );
      const loaded = await loadConfig({
        command: 'query',
        cliOverrides: {},
        env: {},
        cwd: dir,
      });
      expect(unwrap(loaded).effective.mutable).toBe(false);
    });
  });

  describe('error paths', () => {
    it('returns null, writes to stderr, and sets exitCode = 1 on a malformed file', async () => {
      await writeFile(join(dir, 'sparqly.config.yaml'), 'graphStrategy: 42\n');
      const loaded = await loadConfig({
        command: 'query',
        cliOverrides: {},
        env: {},
        cwd: dir,
      });
      expect(loaded).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/graphStrategy/);
    });

    it('returns null on a malformed env var', async () => {
      const loaded = await loadConfig({
        command: 'serve',
        cliOverrides: {},
        env: { SPARQLY_SERVE_PORT: 'abc' },
        cwd: dir,
      });
      expect(loaded).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/SPARQLY_SERVE_PORT/);
    });

    it('returns null when --config path does not exist', async () => {
      const loaded = await loadConfig({
        command: 'query',
        cliOverrides: {},
        env: {},
        cwd: dir,
        configPath: join(dir, 'missing.yaml'),
      });
      expect(loaded).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(stderrText()).toMatch(/missing\.yaml/);
    });
  });

  describe('printConfig', () => {
    it('annotates each key with the layer that won', async () => {
      await writeFile(
        join(dir, 'sparqly.config.yaml'),
        ['sources: "from-file/**/*.ttl"', 'mutable: true', ''].join('\n'),
      );
      const loaded = await loadConfig({
        command: 'serve',
        cliOverrides: { graphStrategy: 'partial' },
        env: { SPARQLY_SERVE_WATCH: 'true' },
        cwd: dir,
      });
      const out = unwrap(loaded).printConfig;
      expect(out).toContain('# sparqly serve --print-config');
      expect(out).toMatch(/sources\s*:\s*"from-file\/\*\*\/\*\.ttl"\s+# file/);
      expect(out).toMatch(/mutable\s*:\s*true\s+# file/);
      expect(out).toMatch(/watch\s*:\s*true\s+# env/);
      expect(out).toMatch(/graphStrategy\s*:\s*"partial"\s+# flag/);
      expect(out).toMatch(/port\s*:\s*3000\s+# default/);
    });

    it('marks positional sources as flag and reports "(none)" without a config file', async () => {
      const loaded = await loadConfig({
        command: 'query',
        cliOverrides: {},
        positionalSources: 'pos/**/*.ttl',
        env: {},
        cwd: dir,
      });
      const out = unwrap(loaded).printConfig;
      expect(out).toContain('# config file: (none)');
      expect(out).toMatch(/sources\s*:\s*"pos\/\*\*\/\*\.ttl"\s+# flag/);
    });
  });

  describe('unknown-key warnings', () => {
    it('warns at top-level, query block, and serve block', async () => {
      await writeFile(
        join(dir, 'sparqly.config.yaml'),
        [
          'bogusTop: 1',
          'query:',
          '  bogusQuery: 2',
          'serve:',
          '  bogusServe: 3',
          '',
        ].join('\n'),
      );
      await loadConfig({
        command: 'query',
        cliOverrides: {},
        env: {},
        cwd: dir,
      });
      const text = stderrText();
      expect(text).toMatch(/bogusTop/);
      expect(text).toMatch(/bogusQuery.*\(query\)/);
      expect(text).toMatch(/bogusServe.*\(serve\)/);
    });
  });
});

describe('runWithConfig', () => {
  let dir: string;
  let originalExitCode: number | string | null | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-runwith-'));
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await rm(dir, { recursive: true, force: true });
  });

  it('invokes the handler with the same effective options that loadConfig would return', async () => {
    await writeFile(
      join(dir, 'sparqly.config.yaml'),
      'serve:\n  port: 8080\n',
    );
    const loaded = await loadConfig({
      command: 'serve',
      cliOverrides: {},
      env: {},
      cwd: dir,
    });

    let received: unknown;
    await runWithConfig(
      {
        command: 'serve',
        passedParams: [],
        options: {},
        cliOverrides: {},
        env: {},
        cwd: dir,
      },
      (effective) => {
        received = effective;
      },
    );
    expect(received).toEqual(unwrap(loaded).effective);
  });

  it('short-circuits to stdout (no handler call) when printConfig is true', async () => {
    const stdout = new StringStream();
    const handler = vi.fn();

    await runWithConfig(
      {
        command: 'query',
        passedParams: ['x/*.ttl'],
        options: { printConfig: true },
        cliOverrides: {},
        env: {},
        cwd: dir,
        stdout,
      },
      handler,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(stdout.text()).toContain('# sparqly query --print-config');
  });

  it('short-circuits with exitCode = 1 (no handler call) when loadConfig errors', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const handler = vi.fn();
      await runWithConfig(
        {
          command: 'serve',
          passedParams: [],
          options: {},
          cliOverrides: {},
          env: { SPARQLY_SERVE_PORT: 'abc' },
          cwd: dir,
        },
        handler,
      );
      expect(handler).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });
});
