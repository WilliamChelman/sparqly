import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dedent from 'dedent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServe, type ServeHandle } from './helpers/serve';

const SAMPLE_A =
  '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:a ex:p ex:c .\n';
const SAMPLE_B =
  '@prefix ex: <http://example.org/> . ex:a ex:p ex:c . ex:a ex:p ex:d .\n';

const TUPLES_SELECT =
  'PREFIX ex: <http://example.org/> SELECT ?o WHERE { ?s ex:p ?o }';

describe('sparqly serve — POST /api/diff (issue #144)', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-e2e-'));
    const alphaPath = join(dir, 'alpha.ttl');
    const betaPath = join(dir, 'beta.ttl');
    await writeFile(alphaPath, SAMPLE_A);
    await writeFile(betaPath, SAMPLE_B);
    const configPath = join(dir, 'sparqly.config.yaml');
    await writeFile(
      configPath,
      dedent`
        sources:
          - id: alpha
            glob: "${alphaPath}"
          - id: beta
            glob: "${betaPath}"
      ` + '\n',
    );
    handle = await startServe(['--config', configPath]);
  });

  afterEach(async () => {
    if (handle) await handle.close();
    handle = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('returns kind=grouped with a HunkedRdfDiff (changed hunk + totals + sourceRecords) on a glob×glob pair', async () => {
    const resp = await fetch(`${handle!.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ left: '@alpha', right: '@beta' }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      hunked: {
        hunks: Array<{
          anchor: string;
          state: string;
          removed: number;
          added: number;
          lines: Array<{ side: string; nquad: string }>;
          sourceRecords: {
            left: Array<{ file: string; line?: number }>;
            right: Array<{ file: string; line?: number }>;
          };
        }>;
        totals: { left: number; right: number };
      };
    };
    expect(json.kind).toBe('grouped');
    expect(json.hunked.totals).toEqual({ left: 2, right: 2 });
    expect(json.hunked.hunks).toHaveLength(1);
    const hunk = json.hunked.hunks[0];
    expect(hunk.anchor).toBe('http://example.org/a');
    expect(hunk.state).toBe('changed');
    expect(hunk.removed).toBe(1);
    expect(hunk.added).toBe(1);
    expect(hunk.lines.filter((l) => l.side === '-').map((l) => l.nquad)).toEqual([
      '<http://example.org/a> <http://example.org/p> <http://example.org/b> .',
    ]);
    expect(hunk.lines.filter((l) => l.side === '+').map((l) => l.nquad)).toEqual([
      '<http://example.org/a> <http://example.org/p> <http://example.org/d> .',
    ]);
    expect(hunk.sourceRecords.left.length).toBeGreaterThan(0);
    expect(hunk.sourceRecords.right.length).toBeGreaterThan(0);
  });

  it('returns kind=tabular with bag-difference rows when both sides project tuples', async () => {
    const resp = await fetch(`${handle!.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        left: '@alpha',
        right: '@beta',
        leftQuery: TUPLES_SELECT,
        rightQuery: TUPLES_SELECT,
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      variables: string[];
      totals: { left: number; right: number };
      diff: {
        added: { row: Record<string, { value: string }>; count: number }[];
        removed: { row: Record<string, { value: string }>; count: number }[];
      };
    };
    expect(json.kind).toBe('tabular');
    expect(json.variables).toEqual(['o']);
    expect(json.totals).toEqual({ left: 2, right: 2 });
    expect(json.diff.added.map((e) => e.row['o'].value)).toEqual([
      'http://example.org/d',
    ]);
    expect(json.diff.removed.map((e) => e.row['o'].value)).toEqual([
      'http://example.org/b',
    ]);
  });

  it('rejects mixed-shape inputs with kind=error and the structured mixed-shape top-level variant', async () => {
    const resp = await fetch(`${handle!.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        left: '@alpha',
        right: '@beta',
        leftQuery:
          'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }',
        rightQuery: TUPLES_SELECT,
      }),
    });
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as {
      kind: string;
      errors: {
        top?: { kind: string; triplesSide?: string; tuplesSide?: string };
      };
    };
    expect(json.kind).toBe('error');
    expect(json.errors.top).toEqual({
      kind: 'mixed-shape',
      triplesSide: 'left',
      tuplesSide: 'right',
    });
  });

  it('returns 400 with a structured (not-stack-trace) error on a malformed body', async () => {
    const resp = await fetch(`${handle!.baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
    const text = await resp.text();
    expect(text).not.toMatch(/at .* \(.*:\d+:\d+\)/);
  });
});
