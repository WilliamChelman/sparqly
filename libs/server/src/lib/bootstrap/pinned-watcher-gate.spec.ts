import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createServer, type CreatedServer } from './create-server';

const execFileAsync = promisify(execFile);

async function git(repo: string, args: ReadonlyArray<string>): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
  return stdout.trim();
}

const SAMPLE_A = '@prefix ex: <http://example.org/> . ex:a ex:p ex:b .\n';
const SAMPLE_B = '@prefix ex: <http://example.org/> . ex:c ex:p ex:d .\n';
const SAMPLE_C = '@prefix ex: <http://example.org/> . ex:e ex:p ex:f .\n';

interface RecordedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: SparqlyLogFields;
}

function recordingLogger(): {
  logger: SparqlyLogger;
  entries: RecordedLog[];
} {
  const entries: RecordedLog[] = [];
  const record =
    (level: RecordedLog['level']) =>
    (msg: string, fields?: SparqlyLogFields): void => {
      entries.push({ level, msg, fields });
    };
  return {
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    entries,
  };
}

interface ConfigResponse {
  sources: Array<{ id: string; kind: string; parentId?: string }>;
}

async function fetchSources(port: number): Promise<ConfigResponse['sources']> {
  const resp = await fetch(`http://localhost:${port}/api/config`);
  return ((await resp.json()) as ConfigResponse).sources;
}

describe('watcher gate — pinned split-glob is never busted by FS events (ADR-0029, issue #278)', () => {
  let repo: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    repo = await mkdtemp(join(tmpdir(), 'sparqly-watcher-gate-'));
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(join(repo, 'a.ttl'), SAMPLE_A);
    await writeFile(join(repo, 'b.ttl'), SAMPLE_B);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
  }, 30_000);

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('does not emit `split-children-invalidated` for a `gitRef`-pinned split-glob when a working-tree file changes', async () => {
    const { logger, entries } = recordingLogger();
    server = await createServer({
      sources: [
        {
          id: 'docs',
          glob: join(repo, '*.ttl'),
          splitByFile: true,
          gitRef: 'main',
        },
      ],
      port: 0,
      watch: true,
      watchDebounceMs: 25,
      logger,
    });

    const before = await fetchSources(server.port);
    expect(
      before
        .filter((s) => s.kind === 'file')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['docs/a.ttl', 'docs/b.ttl']);

    await writeFile(join(repo, 'c.ttl'), SAMPLE_C);
    // Wait long enough for debounce + any errant invalidation to fire.
    await new Promise((r) => setTimeout(r, 300));

    const invalidations = entries.filter(
      (e) =>
        e.msg === 'split-children-invalidated' &&
        (e.fields as { parentId?: string } | undefined)?.parentId === 'docs',
    );
    expect(invalidations).toHaveLength(0);

    const after = await fetchSources(server.port);
    expect(
      after
        .filter((s) => s.kind === 'file')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['docs/a.ttl', 'docs/b.ttl']);
  });
});
