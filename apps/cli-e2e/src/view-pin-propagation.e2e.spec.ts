import { execFile } from 'node:child_process';
import dedent from 'dedent';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import {
  startFakeSparqlEndpoint,
  type FakeSparqlEndpoint,
} from './helpers/fake-sparql';

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

describe('view-pin propagation (ADR-0029, issue #277)', () => {
  let repo: string;
  let configPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-view-pin-prop-'));
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
          - id: kept-view
            from: "@foaf"
            query: "PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }"
          - id: outer-view
            from: "@kept-view"
            query: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('sparqly hash @kept-view --at v1.2.0 hashes the view query against the pinned glob (story 11)', async () => {
    const [pinned, current] = await Promise.all([
      runCli(
        ['hash', '@kept-view', '--at', 'v1.2.0', '--config', configPath, '--quiet'],
        { cwd: repo },
      ),
      runCli(
        ['hash', '@kept-view', '--config', configPath, '--quiet'],
        { cwd: repo },
      ),
    ]);
    expect(pinned.exitCode, `stderr=${pinned.stderr}`).toBe(0);
    expect(current.exitCode, `stderr=${current.stderr}`).toBe(0);
    // The view's query runs over the pre-v1.2.0 content vs. the working tree —
    // distinct upstream content → distinct hash.
    expect(pinned.stdout).not.toBe(current.stdout);
  });

  it('view.from: @<inner-view-id>:<ref> resolves end-to-end (view-of-view chain)', async () => {
    const result = await runCli(
      [
        'query',
        '--config',
        configPath,
        '--quiet',
        '-q',
        'SELECT ?o WHERE { ?s <http://example.org/p> ?o }',
        '@outer-view:v1.2.0',
      ],
      { cwd: repo },
    );
    expect(result.exitCode, `stderr=${result.stderr}`).toBe(0);
    const json = JSON.parse(result.stdout);
    const objects = json.results.bindings.map(
      (b: { o: { value: string } }) => b.o.value,
    );
    // The inner view's FILTER keeps only ex:keep; the pinned glob has ex:old.
    expect(objects).toEqual(['http://example.org/old']);
  });
});

describe('SERVICE clauses inside a pinned view are unaffected by the pin', () => {
  let repo: string;
  let endpoint: FakeSparqlEndpoint;
  let configPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-view-pin-service-'));
    await writeFile(join(repo, 'local.ttl'), OLD_TTL);
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release']);
    await writeFile(join(repo, 'local.ttl'), NEW_TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);

    const REMOTE_BINDINGS = JSON.stringify({
      head: { vars: ['s', 'p', 'o'] },
      results: {
        bindings: [
          {
            s: { type: 'uri', value: 'http://example.org/remote' },
            p: { type: 'uri', value: 'http://example.org/p' },
            o: { type: 'uri', value: 'http://example.org/from-service' },
          },
        ],
      },
    });
    endpoint = await startFakeSparqlEndpoint(({ query }) => {
      if (/^\s*ASK\b/i.test(query)) {
        return {
          contentType: 'application/sparql-results+json',
          body: JSON.stringify({ head: {}, boolean: true }),
        };
      }
      return {
        contentType: 'application/sparql-results+json',
        body: REMOTE_BINDINGS,
      };
    });

    configPath = join(repo, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: local
            glob: "local.ttl"
          - id: hybrid
            from: "@local"
            query: "PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { { ?s ?p ?o } UNION { SERVICE <${endpoint.url}> { ?s ?p ?o } } }"
      ` + '\n',
    );
  }, 30_000);

  afterAll(async () => {
    if (endpoint) await endpoint.close();
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('the SERVICE clause hits the live endpoint while the from: chain reads the pinned glob', async () => {
    const result = await runCli(
      [
        'query',
        '@hybrid',
        '--at',
        'v1.2.0',
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
    const objects = (json.results.bindings as Array<{ o: { value: string } }>)
      .map((b) => b.o.value)
      .sort();
    // Pinned glob contributes ex:old / ex:dropped; SERVICE contributes from-service.
    expect(objects).toContain('http://example.org/from-service');
    expect(objects).toContain('http://example.org/old');
    // The NEW_TTL value (ex:new) should be absent — the pinned glob is at v1.2.0.
    expect(objects).not.toContain('http://example.org/new');
  });
});
