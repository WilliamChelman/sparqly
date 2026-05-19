import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultGlobWalker,
  expandSplitGlobs,
  parseSourceSpecs,
  type ParsedSource,
} from 'core';
import { EngineMap } from '../bootstrap';
import { DiffService } from './diff.service';

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

async function buildSvc(
  registry: ReadonlyArray<ParsedSource>,
  logger?: { debug: (event: string, data: unknown) => void },
): Promise<{ svc: DiffService; engineMap: EngineMap }> {
  const engineMap = await EngineMap.create(registry, { logger });
  const svc = new DiffService(engineMap, registry);
  return { svc, engineMap };
}

const TRIPLES_CONSTRUCT =
  'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }';
const TUPLES_SELECT =
  'PREFIX ex: <http://example.org/> SELECT ?o WHERE { ?s ex:p ?o }';

interface SidePaths {
  dir: string;
  alphaTtl: string;
  betaTtl: string;
}

async function makeRegistryDirs(): Promise<SidePaths> {
  const dir = await mkdtemp(join(tmpdir(), 'sparqly-diff-svc-'));
  const alphaTtl = join(dir, 'alpha.ttl');
  const betaTtl = join(dir, 'beta.ttl');
  await writeFile(
    alphaTtl,
    '@prefix ex: <http://example.org/> . ex:a ex:p ex:b . ex:a ex:p ex:c .\n',
  );
  await writeFile(
    betaTtl,
    '@prefix ex: <http://example.org/> . ex:a ex:p ex:c . ex:a ex:p ex:d .\n',
  );
  return { dir, alphaTtl, betaTtl };
}

describe('DiffService — grouped mode', () => {
  let paths: SidePaths;
  let svc: DiffService;

  beforeEach(async () => {
    paths = await makeRegistryDirs();
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: paths.alphaTtl },
      { id: 'beta', glob: paths.betaTtl },
    ]);
    ({ svc } = await buildSvc(registry));
  });

  afterEach(async () => {
    await rm(paths.dir, { recursive: true, force: true });
  });

  it('returns kind=grouped carrying a HunkedRdfDiff with totals when both sides are triples-shape', async () => {
    const out = await svc.runDiff({ left: '@alpha', right: '@beta' });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    expect(out.hunked.totals).toEqual({ left: 2, right: 2 });
    // Both sides share the named anchor http://example.org/a so there is one
    // hunk, in `changed` state, with one removed and one added line.
    expect(out.hunked.hunks).toHaveLength(1);
    const hunk = out.hunked.hunks[0];
    expect(hunk.anchor).toBe('http://example.org/a');
    expect(hunk.state).toBe('changed');
    expect(hunk.removed).toBe(1);
    expect(hunk.added).toBe(1);
    const sides = hunk.lines.map((l) => l.side).sort();
    expect(sides).toEqual(['+', '-']);
  });

  it('attaches per-hunk source records by default on glob targets (auto source annotation)', async () => {
    const out = await svc.runDiff({ left: '@alpha', right: '@beta' });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    const hunk = out.hunked.hunks[0];
    expect(hunk.sourceRecords.left.length).toBeGreaterThan(0);
    expect(hunk.sourceRecords.left[0].file).toMatch(/alpha\.ttl$/);
    expect(hunk.sourceRecords.right.length).toBeGreaterThan(0);
    expect(hunk.sourceRecords.right[0].file).toMatch(/beta\.ttl$/);
  });

  it('reuses engine-map cache: a second grouped diff against the same @ids does not re-load the source', async () => {
    const debug = vi.fn();
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: paths.alphaTtl },
      { id: 'beta', glob: paths.betaTtl },
    ]);
    const { svc: warmSvc } = await buildSvc(registry, { debug });

    await warmSvc.runDiff({ left: '@alpha', right: '@beta' });
    await warmSvc.runDiff({ left: '@alpha', right: '@beta' });

    const loadEvents = debug.mock.calls.filter(
      ([event]) => event === 'source-loaded',
    );
    const loadedIds = loadEvents.map(
      ([, payload]) => (payload as { source: string }).source,
    );
    expect(loadedIds.sort()).toEqual(['alpha', 'beta']);
  });

  it('honours per-side scoping queries (anonymous view) on the grouped path', async () => {
    const onlyP =
      'PREFIX ex: <http://example.org/> CONSTRUCT { ?s ex:p ?o } WHERE { ?s ex:p ?o }';
    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      leftQuery: onlyP,
      rightQuery: onlyP,
    });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    expect(out.hunked.totals).toEqual({ left: 2, right: 2 });
    expect(out.hunked.hunks).toHaveLength(1);
    expect(out.hunked.hunks[0].anchor).toBe('http://example.org/a');
  });
});

describe('DiffService — tabular mode', () => {
  let paths: SidePaths;
  let svc: DiffService;

  beforeEach(async () => {
    paths = await makeRegistryDirs();
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: paths.alphaTtl },
      { id: 'beta', glob: paths.betaTtl },
    ]);
    ({ svc } = await buildSvc(registry));
  });

  afterEach(async () => {
    await rm(paths.dir, { recursive: true, force: true });
  });

  it('returns kind=tabular with bag-difference rows and per-side totals when both sides are arbitrary SELECTs', async () => {
    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      leftQuery: TUPLES_SELECT,
      rightQuery: TUPLES_SELECT,
    });

    expect(out.kind).toBe('tabular');
    if (out.kind !== 'tabular') return;
    expect(out.variables).toEqual(['o']);
    expect(out.totals).toEqual({ left: 2, right: 2 });
    expect(out.diff.added.map((e) => e.row['o']?.value)).toEqual([
      'http://example.org/d',
    ]);
    expect(out.diff.removed.map((e) => e.row['o']?.value)).toEqual([
      'http://example.org/b',
    ]);
  });

  it('returns kind=error with a structured set-mismatch top-level variant on mismatched variable-name sets', async () => {
    const leftSelect =
      'PREFIX ex: <http://example.org/> SELECT ?o WHERE { ?s ex:p ?o }';
    const rightSelect =
      'PREFIX ex: <http://example.org/> SELECT ?subject WHERE { ?subject ex:p ?o }';

    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      leftQuery: leftSelect,
      rightQuery: rightSelect,
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.top?.kind).toBe('set-mismatch');
    if (out.errors.top?.kind !== 'set-mismatch') return;
    expect([...out.errors.top.left].sort()).toEqual(['o']);
    expect([...out.errors.top.right].sort()).toEqual(['subject']);
  });

  it('returns the structured tabular-blank-node variant inline when a right-side SELECT projects a blank-node column', async () => {
    const blankTtl = join(paths.dir, 'blank.ttl');
    await writeFile(
      blankTtl,
      '@prefix ex: <http://example.org/> . ex:a ex:hasThing _:b1 . ex:a ex:hasThing _:b2 .\n',
    );
    const { svc: svc2 } = await buildSvc(
      parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'blank', glob: blankTtl },
      ]),
    );
    const blankSelect =
      'PREFIX ex: <http://example.org/> SELECT ?s ?thing WHERE { ?s ex:hasThing ?thing }';
    const cleanSelect =
      'PREFIX ex: <http://example.org/> SELECT ?s ?thing WHERE { ?s ex:p ?thing }';

    const out = await svc2.runDiff({
      left: '@alpha',
      right: '@blank',
      leftQuery: cleanSelect,
      rightQuery: blankSelect,
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.right).toEqual({
      kind: 'tabular-blank-node',
      column: 'thing',
    });
    expect(out.errors.left).toBeUndefined();
    expect(out.errors.top).toBeUndefined();
  });

  it('places the structured tabular-blank-node variant on the left when the left SELECT is the offender', async () => {
    const blankTtl = join(paths.dir, 'blank-l.ttl');
    await writeFile(
      blankTtl,
      '@prefix ex: <http://example.org/> . ex:a ex:hasThing _:b1 .\n',
    );
    const { svc: svc2 } = await buildSvc(
      parseSourceSpecs([
        { id: 'alpha', glob: paths.alphaTtl },
        { id: 'blank', glob: blankTtl },
      ]),
    );
    const blankSelect =
      'PREFIX ex: <http://example.org/> SELECT ?s ?thing WHERE { ?s ex:hasThing ?thing }';
    const cleanSelect =
      'PREFIX ex: <http://example.org/> SELECT ?s ?thing WHERE { ?s ex:p ?thing }';

    const out = await svc2.runDiff({
      left: '@blank',
      right: '@alpha',
      leftQuery: blankSelect,
      rightQuery: cleanSelect,
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.left).toEqual({
      kind: 'tabular-blank-node',
      column: 'thing',
    });
    expect(out.errors.right).toBeUndefined();
  });
});

describe('DiffService — error packaging', () => {
  let paths: SidePaths;
  let svc: DiffService;

  beforeEach(async () => {
    paths = await makeRegistryDirs();
    const registry = parseSourceSpecs([
      { id: 'alpha', glob: paths.alphaTtl },
      { id: 'beta', glob: paths.betaTtl },
    ]);
    ({ svc } = await buildSvc(registry));
  });

  afterEach(async () => {
    await rm(paths.dir, { recursive: true, force: true });
  });

  it('returns kind=error with a structured mixed-shape top-level variant when one side is triples and the other tuples', async () => {
    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      leftQuery: TRIPLES_CONSTRUCT,
      rightQuery: TUPLES_SELECT,
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.top).toEqual({
      kind: 'mixed-shape',
      triplesSide: 'left',
      tuplesSide: 'right',
    });
  });

  it('returns kind=error with structured target/unknown-ref variants on both sides when both @ids are unknown', async () => {
    const out = await svc.runDiff({ left: '@nope-l', right: '@nope-r' });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.left).toMatchObject({
      kind: 'target',
      side: 'left',
      target: { kind: 'unknown-ref', ref: '@nope-l' },
    });
    expect(out.errors.right).toMatchObject({
      kind: 'target',
      side: 'right',
      target: { kind: 'unknown-ref', ref: '@nope-r' },
    });
  });

  it('returns kind=error with per-side anonymous-view-execution variants wrapping the underlying parse failures', async () => {
    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      leftQuery: 'SELECT ?s WHERE { ?s ?p',
      rightQuery: 'SELECT ?s WHERE { ?s ?p',
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.left?.kind).toBe('anonymous-view-execution');
    expect(out.errors.right?.kind).toBe('anonymous-view-execution');
  });
});

describe('DiffService — pinned `@id:ref` address (ADR-0029)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'sparqly-diff-pin-'));
    const foaf = join(repo, 'foaf.ttl');
    await writeFile(
      foaf,
      '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:old .\n',
    );
    await git(repo, ['init', '-q', '-b', 'main']);
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'first']);
    await git(repo, ['tag', '-a', 'v1.2.0', '-m', 'release v1.2.0']);
    await writeFile(
      foaf,
      '@prefix ex: <http://example.org/> .\nex:keep ex:p ex:new .\n',
    );
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'second']);
    await git(repo, ['tag', '-a', 'v1.3.0', '-m', 'release v1.3.0']);
  }, 30_000);

  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  it('returns unknown-ref echoing the full `@id:ref` input when the bare id is not in the registry', async () => {
    const registry = parseSourceSpecs([
      { id: 'foaf', glob: join(repo, 'foaf.ttl') },
    ]);
    const engineMap = await EngineMap.create(registry);
    const svc = new DiffService(engineMap, registry);

    const out = await svc.runDiff({
      left: '@nope:v1.2.0',
      right: '@foaf',
    });

    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.errors.left).toMatchObject({
      kind: 'target',
      side: 'left',
      target: {
        kind: 'unknown-ref',
        ref: '@nope:v1.2.0',
        availableIds: ['foaf'],
      },
    });
    expect(out.errors.right).toBeUndefined();
  });

  it('honors a `:ref` pin on a split-glob file child (kind=file) by loading the pinned variant via re-synthesis as a one-file glob', async () => {
    const parentGlob = join(repo, '*.ttl');
    const expanded = await expandSplitGlobs(
      parseSourceSpecs([
        { id: 'docs', glob: parentGlob, splitByFile: true },
      ]),
      { walkGlob: defaultGlobWalker },
    );
    const engineMap = await EngineMap.create(expanded);
    const svc = new DiffService(engineMap, expanded);

    // Working tree currently holds v1.3.0 content. Left = working (no pin),
    // right = pinned at the v1.2.0 tag — should surface the change between
    // the two as a grouped diff against the same anchor.
    const out = await svc.runDiff({
      left: '@docs/foaf.ttl',
      right: '@docs/foaf.ttl:v1.2.0',
    });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    expect(out.hunked.hunks).toHaveLength(1);
    const hunk = out.hunked.hunks[0];
    expect(hunk.anchor).toBe('http://example.org/keep');
    const objects = hunk.lines.map((l) => ({ side: l.side, object: l.object }));
    expect(objects).toEqual(
      expect.arrayContaining([
        { side: '-', object: '<http://example.org/new>' },
        { side: '+', object: '<http://example.org/old>' },
      ]),
    );
  });

  it('loads each side at its `:ref` pin and surfaces the per-tag difference as a grouped diff', async () => {
    const registry = parseSourceSpecs([
      { id: 'foaf', glob: join(repo, 'foaf.ttl') },
    ]);
    const engineMap = await EngineMap.create(registry);
    const svc = new DiffService(engineMap, registry);

    const out = await svc.runDiff({
      left: '@foaf:v1.2.0',
      right: '@foaf:v1.3.0',
    });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    expect(out.hunked.totals).toEqual({ left: 1, right: 1 });
    expect(out.hunked.hunks).toHaveLength(1);
    const hunk = out.hunked.hunks[0];
    expect(hunk.anchor).toBe('http://example.org/keep');
    expect(hunk.state).toBe('changed');
    const objects = hunk.lines.map((l) => ({ side: l.side, object: l.object }));
    expect(objects).toEqual(
      expect.arrayContaining([
        { side: '-', object: '<http://example.org/old>' },
        { side: '+', object: '<http://example.org/new>' },
      ]),
    );
  });
});
