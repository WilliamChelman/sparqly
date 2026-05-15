import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseSourceSpecs,
  type ParsedViewSource,
} from '../sources';
import { GitCliPort } from '../sources/git/git-cli-port';
import { defaultRepoDiscovery } from '../sources/git/pin-glob-source';
import { resolveViewResult } from './view-resolver';

const execFileAsync = promisify(execFile);

async function git(
  repo: string,
  args: ReadonlyArray<string>,
): Promise<string> {
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
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\nex:drop ex:p ex:dropped .\n';
const NEW_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\nex:drop ex:p ex:dropped .\n';

// ADR-0029 / issue #275 slice 4: `view.from: @<glob>:<ref>` propagates the
// pin down onto the upstream glob, so the view query runs against the glob's
// git-tree content at the resolved SHA. The view query, transforms, and id
// stay untouched — the only thing the pin affects is *which* bytes the
// upstream glob loads.
describe('view-of-pinned-glob — resolveViewResult honours `fromGitRef` (ADR-0029, #275)', () => {
  let repo: string;
  let foaf: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-view-pin-int-'));
    foaf = join(repo, 'foaf.ttl');
    await writeFile(foaf, OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v1']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release']);
    await writeFile(foaf, NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'v2']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('runs the view against `foaf.ttl` at v1.2.0 (not the working tree)', async () => {
    const registry = parseSourceSpecs([
      { id: 'foaf', glob: foaf },
      {
        id: 'kept-at-v12',
        from: '@foaf:v1.2.0',
        query:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }',
      },
    ]);
    const view = registry[1] as ParsedViewSource;

    const result = await resolveViewResult({
      view,
      registry,
      configDir: repo,
      gitPort: new GitCliPort(),
      repoDiscovery: defaultRepoDiscovery,
    });

    expect(result.isOk(), JSON.stringify(result.isErr() ? result.error : '')).toBe(true);
    const store = result._unsafeUnwrap();
    const quads = store.getQuads(null, null, null, null);
    expect(quads).toHaveLength(1);
    expect(quads[0].subject.value).toBe('http://example.org/keep');
    expect(quads[0].object.value).toBe('http://example.org/old');
  });
});
