import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SparqlyLogger } from 'common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultsFromFields } from '../../runner/fields/field';
import { initSpec, runInit } from './init';

interface CapturedWarning {
  readonly msg: string;
  readonly fields?: Record<string, unknown>;
}

function captureLogger(): {
  logger: SparqlyLogger;
  warnings: ReadonlyArray<CapturedWarning>;
} {
  const warnings: CapturedWarning[] = [];
  const logger: SparqlyLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (msg, fields) =>
      warnings.push({ msg, fields: fields as Record<string, unknown> }),
    error: () => undefined,
  };
  return { logger, warnings };
}

function captureStream(): {
  write: (chunk: string) => boolean;
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join(''),
  };
}

describe('initSpec — shape', () => {
  it('is named `init`', () => {
    expect(initSpec.name).toBe('init');
  });

  it('does not consume the project sources registry', () => {
    expect(initSpec.configScope).toEqual({ sources: false });
  });

  it('declares no positionals', () => {
    expect(initSpec.positionals ?? []).toEqual([]);
  });

  it('exposes a --force flag with default false', () => {
    const force = initSpec.fields.find((f) => f.key === 'force');
    expect(force).toBeDefined();
    const specs = (force?.flags ?? []).map((f) => f.spec);
    expect(specs).toContain('--force');
    const defaults = defaultsFromFields(initSpec.fields);
    expect(defaults.force).toBe(false);
  });

  it('exitCode returns 1 by default', () => {
    expect(initSpec.exitCode(new Error('boom'))).toBe(1);
  });
});

describe('runInit — handler behavior', () => {
  let workdir: string;
  let stdout: ReturnType<typeof captureStream>;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'sparqly-init-'));
    stdout = captureStream();
  });

  afterEach(() => {
    // We deliberately do not rm -rf — tmpdir entries are short-lived.
  });

  it('writes ./sparqly.config.yaml in CWD on the happy path', async () => {
    const { logger, warnings } = captureLogger();
    await runInit({
      cwd: workdir,
      force: false,
      stdout,
      logger,
    });
    const written = await readFile(
      join(workdir, 'sparqly.config.yaml'),
      'utf8',
    );
    expect(written).toMatch(/sources:\s*\[\]/);
    expect(stdout.text()).toBe('wrote sparqly.config.yaml\n');
    expect(warnings).toEqual([]);
  });

  it('refuses (throws) when CWD has an existing config and --force is not set', async () => {
    const existing = join(workdir, 'sparqly.config.yml');
    await writeFile(existing, '# hand-edited\n', 'utf8');
    const { logger } = captureLogger();
    await expect(
      runInit({ cwd: workdir, force: false, stdout, logger }),
    ).rejects.toThrowError(/sparqly\.config\.yml/);
    const preserved = await readFile(existing, 'utf8');
    expect(preserved).toBe('# hand-edited\n');
    expect(stdout.text()).toBe('');
  });

  it('overwrites an existing CWD config when --force is set', async () => {
    const existing = join(workdir, 'sparqly.config.yaml');
    await writeFile(existing, '# old\n', 'utf8');
    const { logger } = captureLogger();
    await runInit({ cwd: workdir, force: true, stdout, logger });
    const written = await readFile(existing, 'utf8');
    expect(written).not.toMatch(/^# old\n/);
    expect(written).toMatch(/sources:/);
    expect(stdout.text()).toBe('wrote sparqly.config.yaml\n');
  });

  it('writes in CWD and emits a warn-level shadow notice when an ancestor config exists', async () => {
    const parent = workdir;
    const child = join(workdir, 'sub');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(child);
    const ancestor = join(parent, 'sparqly.config.yaml');
    await writeFile(ancestor, 'sources: []\n', 'utf8');
    const { logger, warnings } = captureLogger();
    await runInit({ cwd: child, force: false, stdout, logger });
    const written = await readFile(
      join(child, 'sparqly.config.yaml'),
      'utf8',
    );
    expect(written).toMatch(/sources:/);
    expect(warnings.length).toBe(1);
    expect(warnings[0].msg).toMatch(/ancestor|shadow/i);
    expect(warnings[0].msg).toContain(ancestor);
  });
});
