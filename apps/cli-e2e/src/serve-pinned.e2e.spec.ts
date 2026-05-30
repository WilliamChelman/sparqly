import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

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

const SELECT_OBJECTS = encodeURIComponent(
  'SELECT ?o WHERE { ?s <http://example.org/p> ?o }',
);

interface SparqlJson {
  results: { bindings: Array<{ o: { value: string } }> };
}

async function fetchObjects(
  handle: ServeHandle,
  path: string,
): Promise<string[]> {
  const res = await fetch(`${handle.baseUrl}${path}?query=${SELECT_OBJECTS}`);
  expect(res.status, `${path} status`).toBe(200);
  const json = (await res.json()) as SparqlJson;
  return json.results.bindings.map((b) => b.o.value);
}

describe('sparqly serve — pinned glob sources (ADR-0029, issue #278)', () => {
  let repo: string;
  let configPath: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-serve-pinned-e2e-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);

    configPath = join(repo, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: foaf
            glob: "${foaf}"
      ` + '\n',
    );
  }, 30_000);

  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('--source @id:ref boots and serves content from the git tree at the ref', async () => {
    const handle = await startServe(['--config', configPath, '--source', '@foaf:v1.2.0']);
    try {
      const objects = await fetchObjects(handle, '/api/sparql/foaf');
      expect(objects).toEqual(['http://example.org/old']);
    } finally {
      await handle.close();
    }
  });

  it('GET /api/sparql/<id>:<ref> returns the pinned variant alongside the unpinned route', async () => {
    const handle = await startServe(['--config', configPath]);
    try {
      const unpinned = await fetchObjects(handle, '/api/sparql/foaf');
      expect(unpinned).toEqual(['http://example.org/new']);

      const pinned = await fetchObjects(handle, '/api/sparql/foaf:v1.2.0');
      expect(pinned).toEqual(['http://example.org/old']);
    } finally {
      await handle.close();
    }
  });

  it('logs floating-ref `<ref> → <sha>` resolution at boot', async () => {
    const headSha = await git(repo, ['rev-parse', 'HEAD']);
    const handle = await startServe([
      '--config',
      configPath,
      '--source',
      '@foaf:main',
    ]);
    try {
      // Issue one request so the engine has materialized.
      await fetchObjects(handle, '/api/sparql/foaf');
      expect(handle.stderr()).toContain(`git-pin: main → ${headSha}`);
    } finally {
      await handle.close();
    }
  });

  it('--watch does not bust the pinned source on working-tree edits', async () => {
    const handle = await startServe([
      '--config',
      configPath,
      '--source',
      '@foaf:v1.2.0',
      '--watch',
      '--watch-debounce',
      '50',
    ]);
    try {
      const before = await fetchObjects(handle, '/api/sparql/foaf');
      expect(before).toEqual(['http://example.org/old']);

      await writeFile(
        join(repo, 'foaf.ttl'),
        '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:third .\n',
      );
      // Wait long enough for the debounce window to fire if it were going to.
      await new Promise((r) => setTimeout(r, 400));

      const after = await fetchObjects(handle, '/api/sparql/foaf');
      expect(after).toEqual(['http://example.org/old']);
    } finally {
      await handle.close();
    }
  });
});
