import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Store, Writer } from 'n3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAnnotateTransform } from '../annotate-transform';
import { resolveSourceResult } from '../resolve-source-result';
import type { ParsedGlobSource } from '../source-spec';

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

const TTL = '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\n';

/**
 * Produce a stable N-Quads form of the source-record shape, with two
 * normalizations so the golden is repeatable: the temp-dir-derived file IRI
 * is replaced with `<file:///FIXTURE/foaf.ttl>`, and blank-node labels are
 * relabelled `_:r0`, `_:r1`, ... in order of first occurrence. Lines are
 * sorted lexicographically.
 */
async function normalizeAsync(store: Store, repoRoot: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const writer = new Writer({ format: 'application/n-quads' });
    writer.addQuads(store.getQuads(null, null, null, null));
    writer.end((err, raw) => {
      if (err) return rejectP(err);
      const fileIri = `<file://${repoRoot}/foaf.ttl>`;
      let rewritten = raw.split(fileIri).join('<file:///FIXTURE/foaf.ttl>');
      const bnodeMap = new Map<string, string>();
      rewritten = rewritten.replace(/_:[^\s<>"]+/g, (label) => {
        if (!bnodeMap.has(label)) bnodeMap.set(label, `_:r${bnodeMap.size}`);
        return bnodeMap.get(label) as string;
      });
      const lines = rewritten.split('\n').filter((l) => l.length > 0).sort();
      resolveP(`${lines.join('\n')}\n`);
    });
  });
}

describe('pinned-source N-Quads golden shape (ADR-0029, #273)', () => {
  let repo: string;
  let oldSha: string;
  let foafPath: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-pin-golden-'));
    foafPath = join(repo, 'foaf.ttl');
    await git(repo, ['init', '-q', '-b', 'main']);
    await writeFile(foafPath, TTL);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    oldSha = await git(repo, ['rev-parse', 'HEAD']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
  }, 30_000);

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  function pinnedSource(gitRef: string): ParsedGlobSource {
    return {
      kind: 'glob',
      glob: foafPath,
      id: 'foaf',
      gitRef,
      transforms: [
        { key: 'annotateSource', apply: parseAnnotateTransform({}) },
      ],
    };
  }

  function expectedNQuads(ref: string, sha: string): string {
    return [
      '<<(<http://example.org/keep> <http://example.org/p> <http://example.org/old>)>> <urn:sparqly:source> _:r0 .',
      '<http://example.org/keep> <http://example.org/p> <http://example.org/old> .',
      `_:r0 <urn:sparqly:file> <file:///FIXTURE/foaf.ttl> .`,
      `_:r0 <urn:sparqly:gitRef> "${ref}" .`,
      `_:r0 <urn:sparqly:gitSha> "${sha}" .`,
      '_:r0 <urn:sparqly:line> "2"^^<http://www.w3.org/2001/XMLSchema#integer> .',
    ]
      .sort()
      .join('\n') + '\n';
  }

  it('refString = annotated tag — exact source-record N-Quads shape', async () => {
    const result = await resolveSourceResult(pinnedSource('v1.2.0'), {
      configDir: repo,
    });
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const actual = await normalizeAsync(result.value.store, repo);
    expect(actual).toBe(expectedNQuads('v1.2.0', oldSha));
  });

  it('refString = full SHA — exact source-record N-Quads shape', async () => {
    const result = await resolveSourceResult(pinnedSource(oldSha), {
      configDir: repo,
    });
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const actual = await normalizeAsync(result.value.store, repo);
    expect(actual).toBe(expectedNQuads(oldSha, oldSha));
  });

  it('refString = branch — exact source-record N-Quads shape', async () => {
    const result = await resolveSourceResult(pinnedSource('main'), {
      configDir: repo,
    });
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');
    const actual = await normalizeAsync(result.value.store, repo);
    expect(actual).toBe(expectedNQuads('main', oldSha));
  });
});
