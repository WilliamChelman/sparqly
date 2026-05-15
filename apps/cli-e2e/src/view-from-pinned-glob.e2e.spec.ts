import { execFile } from 'node:child_process';
import dedent from 'dedent';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

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
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\nex:drop ex:p ex:dropped .\n';
const NEW_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\nex:drop ex:p ex:dropped .\n';

describe('view.from accepts `@<id>:<ref>` for a glob upstream (ADR-0029, issue #275)', () => {
  let repo: string;
  let configPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-view-from-pin-'));
    await writeFile(join(repo, 'foaf.ttl'), OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release']);
    await writeFile(join(repo, 'foaf.ttl'), NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);

    configPath = join(repo, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: foaf
            glob: "foaf.ttl"
          - id: kept-at-v12
            from: "@foaf:v1.2.0"
            query: "PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }"
      ` + '\n',
    );
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('runs the view against the pinned glob content (pre-v1.2.0 object), not the working tree', async () => {
    const result = await runCli(
      [
        'query',
        '@kept-at-v12',
        '--config',
        configPath,
        '--quiet',
        '-q',
        'SELECT ?o WHERE { ?s <http://example.org/p> ?o }',
      ],
      { cwd: repo },
    );

    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    expect(objects).toEqual(['http://example.org/old']);
  });
});

describe('view.from with `:<ref>` against a non-pinnable upstream errors (ADR-0029)', () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-view-from-pin-nonglob-'));
  });

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  // View-of-view chains were rejected up-front in slice #275 and now propagate
  // through to the leaf glob (slice #277). The success path is covered by
  // `view-pin-propagation.e2e.spec.ts`; the chain-bottom-on-endpoint case is
  // covered below and in `pinned-errors.e2e.spec.ts`.

  it('errors when the upstream is an endpoint with `:<ref>`', async () => {
    const configPath = join(scratch, 'view-of-endpoint.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: remote
            endpoint: "http://localhost:65535/sparql"
          - id: pinned-remote
            from: "@remote:v1.2.0"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    const result = await runCli(
      [
        'query',
        '@pinned-remote',
        '--config',
        configPath,
        '--quiet',
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { cwd: scratch },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(
      /endpoint.*pin|not yet supported|cannot pin/i,
    );
  });
});
