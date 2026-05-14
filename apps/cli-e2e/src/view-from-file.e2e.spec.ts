import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

const CLEARED_ENV = {} as const;

const FOO_TTL =
  '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:v1 .\nex:drop ex:p ex:v2 .\n';
const BAR_TTL = '@prefix ex: <http://example.org/> .\nex:bar ex:p ex:b .\n';

describe('sparqly query @<viewId> — view declared `from: @<file-child>` (ADR-0027 / #267)', () => {
  let scratch: string;
  let configPath: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'sparqly-view-from-file-'));
    await writeFile(join(scratch, 'foo.ttl'), FOO_TTL);
    await writeFile(join(scratch, 'bar.ttl'), BAR_TTL);
    configPath = join(scratch, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: docs
            glob: "${join(scratch, '*.ttl')}"
            splitByFile: true
          - id: kept
            from: "@docs/foo.ttl"
            query: "PREFIX ex: <http://example.org/> CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o FILTER(?s = ex:keep) }"
      ` + '\n',
    );
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('runs the view against the named file child and returns only the filtered triples', async () => {
    const result = await runCli(
      [
        'query',
        '@kept',
        '--config',
        configPath,
        '--quiet',
        '-q',
        'SELECT ?s WHERE { ?s ?p ?o }',
      ],
      { env: CLEARED_ENV },
    );

    expect(result.exitCode, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout);
    const subjects = json.results.bindings.map(
      (b: { s: { value: string } }) => b.s.value,
    );
    expect(subjects).toEqual(['http://example.org/keep']);
  });
});
