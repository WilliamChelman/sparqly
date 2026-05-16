import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './helpers/run-cli';
import { diffBodyLines } from './helpers/hash';

describe('sparqly diff --format=turtle', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-turtle-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits two formatter blocks with shared prefixes from the source files', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--format=turtle',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const removedHeader = result.stdout.indexOf('# --- removed ---');
    const addedHeader = result.stdout.indexOf('# --- added ---');
    expect(removedHeader).toBeGreaterThanOrEqual(0);
    expect(addedHeader).toBeGreaterThan(removedHeader);

    const removedBlock = result.stdout.slice(removedHeader, addedHeader);
    const addedBlock = result.stdout.slice(addedHeader);

    // Each block runs through the formatter: prefixes applied, CURIEs used.
    expect(removedBlock).toContain('@prefix ex: <http://example.org/>');
    expect(removedBlock).toContain('ex:c ex:q ex:d');
    expect(removedBlock).not.toContain('<http://example.org/c>');

    expect(addedBlock).toContain('@prefix ex: <http://example.org/>');
    expect(addedBlock).toContain('ex:e ex:r ex:f');
    expect(addedBlock).not.toContain('<http://example.org/e>');
  });

  it('default --format=human applies CURIE shortening on each line', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );

    const result = await runCli(['diff', '--quiet', left, right]);

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    // Loader-attached source records (ADR-0032) append a trailing
    // `# <path>:<line>` comment per +/- hunk on glob/file targets.
    expect(lines).toEqual([
      expect.stringMatching(/^- ex:c ex:q ex:d \. # .*left\.ttl:3$/),
      expect.stringMatching(/^\+ ex:e ex:r ex:f \. # .*right\.ttl:3$/),
    ]);
  });

  it('--format=json is unchanged: emits full IRIs', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=json', left, right],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.added).toHaveLength(1);
    expect(parsed.added[0].s.value).toBe('http://example.org/c');
    expect(parsed.added[0].p.value).toBe('http://example.org/q');
  });

  it('--format=rdf-patch is unchanged: emits full IRIs', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=rdf-patch', left, right],
      { cwd: dir },
    );

    expect(result.exitCode).toBe(1);
    const lines = diffBodyLines(result.stdout);
    // Loader-attached source records (ADR-0032) append a trailing
    // `# <path>:<line>` comment per A/D line on glob/file targets.
    expect(lines).toEqual([
      expect.stringMatching(
        /^A <http:\/\/example\.org\/c> <http:\/\/example\.org\/q> <http:\/\/example\.org\/d> \. # .*right\.ttl:3$/,
      ),
    ]);
  });

  it('emits one statement per line with `# from <relative-path>:<line>` directly above each, when both sides declare `annotateSource`', async () => {
    // The annotateSource transform records absolute file:// IRIs derived from
    // realpath; the diff renderer renders them relative to the CLI cwd.
    // Resolve the tmp dir's symlinks here so the relative path is stable.
    const resolvedDir = await realpath(dir);
    const left = join(resolvedDir, 'left.ttl');
    const right = join(resolvedDir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:e ex:r ex:f .
      ` + '\n',
    );
    const configPath = join(resolvedDir, 'sparqly.diff.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: left
            glob: "${left}"
            transforms:
              - annotateSource: {}
          - id: right
            glob: "${right}"
            transforms:
              - annotateSource: {}
      ` + '\n',
    );

    const result = await runCli(
      [
        'diff',
        '--quiet',
        '--format=turtle',
        '--config',
        configPath,
        '--left',
        '@left',
        '--right',
        '@right',
      ],
      { cwd: resolvedDir },
    );

    expect(result.exitCode).toBe(1);
    const lines = result.stdout.split('\n');
    const removedStmtIdx = lines.findIndex((l) => l === 'ex:c ex:q ex:d .');
    expect(removedStmtIdx).toBeGreaterThan(0);
    expect(lines[removedStmtIdx - 1]).toBe('# from left.ttl:3');

    const addedStmtIdx = lines.findIndex((l) => l === 'ex:e ex:r ex:f .');
    expect(addedStmtIdx).toBeGreaterThan(0);
    expect(lines[addedStmtIdx - 1]).toBe('# from right.ttl:3');
  });

  it('emits flat statements (no `;` grouping) preceded by `# from` comments on inline globs (loader sidecar always-on, ADR-0032)', async () => {
    const resolvedDir = await realpath(dir);
    const left = join(resolvedDir, 'left.ttl');
    const right = join(resolvedDir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b1 ;
              ex:p ex:b2 .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b1 ;
              ex:p ex:b2 ;
              ex:q ex:c .
      ` + '\n',
    );

    const result = await runCli(
      ['diff', '--quiet', '--format=turtle', left, right],
      { cwd: resolvedDir },
    );

    expect(result.exitCode).toBe(1);
    // Sidecar-derived `# from <path>:<line>` precedes each statement.
    expect(result.stdout).toMatch(/^# from right\.ttl:\d+$/m);
    // Added statement is on its own line.
    expect(result.stdout).toMatch(/\nex:a ex:q ex:c \.\n/);
    // No `;` grouping in the added block (each statement stands alone).
    const addedHeaderIdx = result.stdout.indexOf('# --- added ---');
    const addedBlock = result.stdout.slice(addedHeaderIdx);
    expect(addedBlock).not.toContain(';');
  });

  it('emits both block headers even when one side is empty', async () => {
    const left = join(dir, 'left.ttl');
    const right = join(dir, 'right.ttl');
    await writeFile(
      left,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
      ` + '\n',
    );
    await writeFile(
      right,
      dedent`
        @prefix ex: <http://example.org/> .
        ex:a ex:p ex:b .
        ex:c ex:q ex:d .
      ` + '\n',
    );

    const result = await runCli([
      'diff',
      '--quiet',
      '--format=turtle',
      left,
      right,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('# --- removed ---');
    expect(result.stdout).toContain('# --- added ---');
    expect(result.stdout).toContain('ex:c ex:q ex:d');
  });
});
