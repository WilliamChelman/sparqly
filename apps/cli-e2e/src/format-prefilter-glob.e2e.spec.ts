import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';

describe('sparqly format — rejects prefilter on a glob source', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-format-prefilter-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a glob source carrying a prefilter at config-validation time', async () => {
    const configPath = join(dir, 'sparqly.format.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - glob: "data/**/*.ttl"
            prefilter: "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n',
    );

    const result = await runCli(['format', '--config', configPath], {
      cwd: dir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/prefilter/i);
    expect(result.stderr).toMatch(
      /sparqly query --format=turtle.*sparqly format/,
    );
  });

  it('rejects a glob source carrying a prefilterFile at config-validation time', async () => {
    const configPath = join(dir, 'sparqly.format.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - glob: "data/**/*.ttl"
            prefilterFile: "filter.rq"
      ` + '\n',
    );
    await writeFile(
      join(dir, 'data.ttl'),
      '@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n',
    );
    await writeFile(
      join(dir, 'filter.rq'),
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }\n',
    );

    const result = await runCli(['format', '--config', configPath], {
      cwd: dir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/prefilter/i);
    expect(result.stderr).toMatch(
      /sparqly query --format=turtle.*sparqly format/,
    );
  });
});
