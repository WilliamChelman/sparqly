import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SparqlyLogFields, SparqlyLogger } from 'common';
import { createServer, type CreatedServer } from './create-server';

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

const OLD_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\n';
const NEW_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\n';

const SELECT_OBJECTS = 'SELECT ?o WHERE { ?s <http://example.org/p> ?o }';

describe('createServer — `--source @id:ref` scopes to a pinned variant (ADR-0029, issue #278)', () => {
  let repo: string;
  let server: CreatedServer | undefined;

  beforeEach(async () => {
    Logger.overrideLogger(false);
    repo = await mkdtemp(join(tmpdir(), 'sparqly-serve-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
  }, 30_000);

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('serves only the pinned variant and returns content from the git tree at the ref', async () => {
    server = await createServer({
      sources: [{ id: 'foaf', glob: join(repo, 'foaf.ttl') }],
      scope: '@foaf:v1.2.0',
      port: 0,
    });

    const configRes = await fetch(`http://localhost:${server.port}/api/config`);
    const configJson = (await configRes.json()) as {
      sources: Array<{ id: string }>;
    };
    expect(configJson.sources.map((s) => s.id)).toEqual(['foaf']);

    const queryRes = await fetch(
      `http://localhost:${server.port}/api/sparql/foaf?query=${encodeURIComponent(
        SELECT_OBJECTS,
      )}`,
    );
    expect(queryRes.status).toBe(200);
    const json = (await queryRes.json()) as {
      results: { bindings: Array<{ o: { value: string } }> };
    };
    expect(json.results.bindings.map((b) => b.o.value)).toEqual([
      'http://example.org/old',
    ]);
  });

  it('GET /api/sparql/<id>:<ref> resolves an on-demand pinned variant alongside the unpinned route', async () => {
    server = await createServer({
      sources: [{ id: 'foaf', glob: join(repo, 'foaf.ttl') }],
      port: 0,
    });

    const unpinned = await fetch(
      `http://localhost:${server.port}/api/sparql/foaf?query=${encodeURIComponent(
        SELECT_OBJECTS,
      )}`,
    );
    expect(unpinned.status).toBe(200);
    const unpinnedJson = (await unpinned.json()) as {
      results: { bindings: Array<{ o: { value: string } }> };
    };
    expect(unpinnedJson.results.bindings.map((b) => b.o.value)).toEqual([
      'http://example.org/new',
    ]);

    const pinned = await fetch(
      `http://localhost:${server.port}/api/sparql/foaf:v1.2.0?query=${encodeURIComponent(
        SELECT_OBJECTS,
      )}`,
    );
    expect(pinned.status).toBe(200);
    const pinnedJson = (await pinned.json()) as {
      results: { bindings: Array<{ o: { value: string } }> };
    };
    expect(pinnedJson.results.bindings.map((b) => b.o.value)).toEqual([
      'http://example.org/old',
    ]);
  });

  it('logs `<ref> → <sha>` at boot for every floating-ref pinned source', async () => {
    const { logger, entries } = recordingLogger();
    server = await createServer({
      sources: [{ id: 'foaf', glob: join(repo, 'foaf.ttl'), gitRef: 'main' }],
      port: 0,
      logger,
    });

    const headSha = await git(repo, ['rev-parse', 'HEAD']);
    const pinLogs = entries.filter(
      (e) => e.level === 'info' && e.msg.startsWith('git-pin: '),
    );
    expect(pinLogs).toHaveLength(1);
    expect(pinLogs[0].msg).toBe(`git-pin: main → ${headSha}`);
  });

  it('keeps floating-ref source content stable across requests even when the working-tree file changes', async () => {
    server = await createServer({
      sources: [{ id: 'foaf', glob: join(repo, 'foaf.ttl'), gitRef: 'main' }],
      port: 0,
    });

    const first = (await (
      await fetch(
        `http://localhost:${server.port}/api/sparql/foaf?query=${encodeURIComponent(
          SELECT_OBJECTS,
        )}`,
      )
    ).json()) as { results: { bindings: Array<{ o: { value: string } }> } };
    expect(first.results.bindings.map((b) => b.o.value)).toEqual([
      'http://example.org/new',
    ]);

    // Mutate working tree to a third revision after server start.
    await writeFile(
      join(repo, 'foaf.ttl'),
      '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:third .\n',
    );

    const second = (await (
      await fetch(
        `http://localhost:${server.port}/api/sparql/foaf?query=${encodeURIComponent(
          SELECT_OBJECTS,
        )}`,
      )
    ).json()) as { results: { bindings: Array<{ o: { value: string } }> } };
    expect(second.results.bindings.map((b) => b.o.value)).toEqual([
      'http://example.org/new',
    ]);
  });
});
