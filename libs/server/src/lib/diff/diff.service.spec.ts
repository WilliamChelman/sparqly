import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSourceSpecs } from 'core';
import { DiffService } from './diff.service';

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
    svc = new DiffService(registry);
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

  it('skipAutoSourceAnnotation leaves per-hunk source records empty on glob targets', async () => {
    const out = await svc.runDiff({
      left: '@alpha',
      right: '@beta',
      skipAutoSourceAnnotation: true,
    });

    expect(out.kind).toBe('grouped');
    if (out.kind !== 'grouped') return;
    for (const hunk of out.hunked.hunks) {
      expect(hunk.sourceRecords.left).toEqual([]);
      expect(hunk.sourceRecords.right).toEqual([]);
    }
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
    svc = new DiffService(registry);
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
    const svc2 = new DiffService(
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
    const svc2 = new DiffService(
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
    svc = new DiffService(registry);
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
