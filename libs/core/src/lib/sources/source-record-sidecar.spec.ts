import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveSourceResult } from './resolve-source-result';
import { parseSourceSpec } from './source-spec';
import type { ParsedGlobSource } from './source-spec';

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

describe('SourceRecordSidecar — loader emission (ADR-0032)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-sidecar-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('working-tree glob: emits one entry per asserted triple, keyed graph-agnostically as `<s> <p> <o> .`', async () => {
    const file = join(dir, 'a.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const target = parseSourceSpec(join(dir, '*.ttl'));
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');

    const sidecar = result.value.sourceRecords;
    expect(sidecar).toBeDefined();
    if (sidecar === undefined) throw new Error('unreachable');

    const k1 =
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .';
    const k2 =
      '<http://example.org/c> <http://example.org/q> <http://example.org/d> .';
    expect([...sidecar.keys()].sort()).toEqual([k1, k2].sort());
    expect(sidecar.get(k1)).toEqual([{ file: `file://${file}`, line: 2 }]);
    expect(sidecar.get(k2)).toEqual([{ file: `file://${file}`, line: 3 }]);
  });

  it('pinned glob: every entry carries gitRef and gitSha sourced from the pin context, no RDF-star round-trip', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'sparqly-sidecar-pin-'));
    try {
      await git(repo, ['init', '-q', '-b', 'main']);
      const file = join(repo, 'foaf.ttl');
      await writeFile(
        file,
        dedent`
          @prefix ex: <http://example.org/> .
          ex:keep ex:p ex:old .
        ` + '\n',
      );
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-q', '-m', 'first']);
      const sha = await git(repo, ['rev-parse', 'HEAD']);
      await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);

      const target: ParsedGlobSource = {
        kind: 'glob',
        glob: file,
        id: 'foaf',
        gitRef: 'v1.2.0',
        // No `annotateSource` transform — we are verifying the sidecar gets
        // pin provenance directly from the loader without RDF-star detour.
      };
      const result = await resolveSourceResult(target);

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) throw new Error('unreachable');
      if (result.value.mode !== 'materialized') throw new Error('unreachable');

      const sidecar = result.value.sourceRecords;
      expect(sidecar).toBeDefined();
      if (sidecar === undefined) throw new Error('unreachable');

      const k =
        '<http://example.org/keep> <http://example.org/p> <http://example.org/old> .';
      expect(sidecar.get(k)).toEqual([
        {
          file: `file://${file}`,
          line: 2,
          gitRef: 'v1.2.0',
          gitSha: sha,
        },
      ]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it('multi-line literal: emits both `line` and `endLine` on the record', async () => {
    const file = join(dir, 'multi.ttl');
    await writeFile(
      file,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p """one
        two
        three""" .
      ` + '\n',
    );

    const target = parseSourceSpec(file);
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');

    const sidecar = result.value.sourceRecords;
    if (sidecar === undefined) throw new Error('unreachable');

    expect(sidecar.size).toBe(1);
    const [record] = [...sidecar.values()][0];
    expect(record.file).toBe(`file://${file}`);
    expect(record.line).toBe(2);
    expect(record.endLine).toBe(4);
  });

  it('rdf/xml format: parser surfaces no line numbers; sidecar omits the `line` field', async () => {
    const file = join(dir, 'a.rdf');
    await writeFile(
      file,
      [
        '<?xml version="1.0"?>',
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
        '         xmlns:ex="http://example.org/">',
        '  <rdf:Description rdf:about="http://example.org/a">',
        '    <ex:p rdf:resource="http://example.org/b"/>',
        '  </rdf:Description>',
        '</rdf:RDF>',
        '',
      ].join('\n'),
    );

    const target = parseSourceSpec(file);
    const result = await resolveSourceResult(target);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) throw new Error('unreachable');
    if (result.value.mode !== 'materialized') throw new Error('unreachable');

    const sidecar = result.value.sourceRecords;
    if (sidecar === undefined) throw new Error('unreachable');

    expect(sidecar.size).toBe(1);
    const [record] = [...sidecar.values()][0];
    expect(record.file).toBe(`file://${file}`);
    expect(record.line).toBeUndefined();
    expect(record.endLine).toBeUndefined();
  });
});
