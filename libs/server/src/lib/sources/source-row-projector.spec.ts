import { describe, expect, it } from 'vitest';
import type { ParsedSource } from 'core';
import {
  projectSourceRow,
  projectSplitGlobMeta,
  type DiskBackedState,
  type InMemoryState,
  type LoadMetrics,
  type SourceRow,
  type SourceRuntime,
} from './source-row-projector';

const inMemoryGlob: ParsedSource = {
  kind: 'glob',
  id: 'docs',
  glob: 'docs/**/*.ttl',
};

const diskGlob: ParsedSource = {
  kind: 'glob',
  id: 'big',
  glob: 'data/**/*.nq',
  storage: 'disk',
};

const splitChild: ParsedSource = {
  kind: 'file',
  id: 'docs/people/alice.ttl',
  path: '/abs/docs/people/alice.ttl',
  parentId: 'docs',
};

const diskChild: ParsedSource = {
  kind: 'file',
  id: 'big/part-0.nq',
  path: '/abs/data/part-0.nq',
  parentId: 'big',
  storage: 'disk',
};

const empty: ParsedSource = {
  kind: 'empty',
  id: 'blank',
};

const endpoint: ParsedSource = {
  kind: 'endpoint',
  id: 'wikidata',
  endpoint: 'https://query.wikidata.org/sparql',
};

const IN_MEMORY_STATES: InMemoryState[] = [
  'not-loaded',
  'loading',
  'loaded',
  'failed',
];
const DISK_BACKED_STATES: DiskBackedState[] = [
  'not-built',
  'indexing',
  'ready',
  'stale',
  'failed',
];

describe('projectSourceRow — Layer 1 (identity & state)', () => {
  describe('in-memory mode', () => {
    for (const source of [inMemoryGlob, splitChild, empty]) {
      for (const state of IN_MEMORY_STATES) {
        it(`projects ${source.kind} '${source.id}' with state '${state}'`, () => {
          const runtime: SourceRuntime = { mode: 'in-memory', state };
          const row = projectSourceRow(source, runtime);
          const expected: SourceRow = {
            mode: 'in-memory',
            id: source.id as string,
            kind: source.kind as 'glob' | 'file' | 'empty',
            state,
          };
          // File sources are split-glob children (CONTEXT.md, **File source**)
          // — they always carry the meta's id back, even at Layer 1, so the
          // page can group children under their meta without a second lookup.
          if (source.kind === 'file') expected.parentId = source.parentId;
          expect(row).toEqual<SourceRow>(expected);
        });
      }
    }

    it('carries parentId for split-glob File children', () => {
      const row = projectSourceRow(splitChild, {
        mode: 'in-memory',
        state: 'not-loaded',
      });
      expect(row).toEqual<SourceRow>({
        mode: 'in-memory',
        id: 'docs/people/alice.ttl',
        kind: 'file',
        state: 'not-loaded',
        parentId: 'docs',
      });
    });
  });

  describe('disk-backed mode', () => {
    for (const source of [diskGlob, diskChild]) {
      for (const state of DISK_BACKED_STATES) {
        it(`projects ${source.kind} '${source.id}' with state '${state}'`, () => {
          const runtime: SourceRuntime = { mode: 'disk-backed', state };
          const row = projectSourceRow(source, runtime);
          expect(row.mode).toBe('disk-backed');
          if (row.mode !== 'disk-backed') throw new Error('narrow');
          expect(row.id).toBe(source.id);
          expect(row.kind).toBe(source.kind);
          expect(row.state).toBe(state);
        });
      }
    }

    it('carries parentId for split-glob disk-backed File children', () => {
      const row = projectSourceRow(diskChild, {
        mode: 'disk-backed',
        state: 'ready',
      });
      expect(row).toEqual<SourceRow>({
        mode: 'disk-backed',
        id: 'big/part-0.nq',
        kind: 'file',
        state: 'ready',
        parentId: 'big',
      });
    });
  });

  describe('endpoint mode', () => {
    it('omits any state-machine field for pass-through endpoint sources', () => {
      const row = projectSourceRow(endpoint, { mode: 'endpoint' });
      expect(row).toEqual<SourceRow>({
        mode: 'endpoint',
        id: 'wikidata',
        kind: 'endpoint',
        // Layer 4 (#359) — the endpoint URL is part of every endpoint row;
        // its presence here keeps the equality assertion exhaustive.
        endpointUrl: 'https://query.wikidata.org/sparql',
      });
      // The discriminated union forbids `state` on endpoint rows — assert at
      // runtime too so a regression that adds it loudly fails this spec.
      expect((row as Record<string, unknown>).state).toBeUndefined();
    });
  });

  describe('default flag', () => {
    it('surfaces default: true on the row when the source is marked default', () => {
      const row = projectSourceRow(
        { ...inMemoryGlob, default: true },
        { mode: 'in-memory', state: 'not-loaded' },
      );
      expect(row.default).toBe(true);
    });

    it('omits default when the source is not the Default source', () => {
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'not-loaded',
      });
      expect('default' in row).toBe(false);
    });

    it('surfaces default on endpoint rows too', () => {
      const row = projectSourceRow(
        { ...endpoint, default: true },
        { mode: 'endpoint' },
      );
      expect(row.default).toBe(true);
    });
  });
});

describe('projectSourceRow — Layer 2 (materialization metrics, #355)', () => {
  const METRICS: LoadMetrics = {
    quads: 1234,
    files: 7,
    loadedAt: 1_700_000_000_000,
    loadMs: 250,
  };

  describe('in-memory mode', () => {
    it('emits quads, files, loadedAt, loadMs on a loaded row', () => {
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: METRICS,
      });
      expect(row).toMatchObject({
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'loaded',
        quads: 1234,
        files: 7,
        loadedAt: 1_700_000_000_000,
        loadMs: 250,
      });
    });

    it('omits Layer 2 fields when the metrics block has no quads (e.g. disk-backed never carries quads yet)', () => {
      // The manifest `quadCount` slice is forward-compatible additive (#352
      // "Out of scope: Backfilling quadCount into pre-existing manifests").
      // The projector must propagate that absence: a metrics block without
      // `quads` produces a row without `quads`.
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: { files: 1, loadedAt: 1, loadMs: 1 },
      });
      expect('quads' in row).toBe(false);
      expect((row as { files?: number }).files).toBe(1);
    });

    for (const state of ['not-loaded', 'loading', 'failed'] as InMemoryState[]) {
      it(`omits Layer 2 fields when state is '${state}' even if runtime carries metrics`, () => {
        const row = projectSourceRow(inMemoryGlob, {
          mode: 'in-memory',
          state,
          metrics: METRICS,
        });
        expect('quads' in row).toBe(false);
        expect('files' in row).toBe(false);
        expect('loadedAt' in row).toBe(false);
        expect('loadMs' in row).toBe(false);
      });
    }

    it('omits Layer 2 fields when loaded but runtime carries no metrics block (e.g. legacy reads)', () => {
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'loaded',
      });
      expect('quads' in row).toBe(false);
      expect('files' in row).toBe(false);
      expect('loadedAt' in row).toBe(false);
      expect('loadMs' in row).toBe(false);
    });
  });

  describe('disk-backed mode', () => {
    it('emits files, loadedAt, loadMs on a ready row (quads optional until manifest slice)', () => {
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'ready',
        metrics: { files: 3, loadedAt: 1, loadMs: 42 },
      });
      expect(row).toMatchObject({
        mode: 'disk-backed',
        state: 'ready',
        files: 3,
        loadedAt: 1,
        loadMs: 42,
      });
      expect('quads' in row).toBe(false);
    });

    for (const state of [
      'not-built',
      'indexing',
      'stale',
      'failed',
    ] as DiskBackedState[]) {
      it(`omits Layer 2 fields when state is '${state}' even if runtime carries metrics`, () => {
        const row = projectSourceRow(diskGlob, {
          mode: 'disk-backed',
          state,
          metrics: METRICS,
        });
        expect('quads' in row).toBe(false);
        expect('files' in row).toBe(false);
        expect('loadedAt' in row).toBe(false);
        expect('loadMs' in row).toBe(false);
      });
    }
  });

  describe('endpoint mode', () => {
    it('never carries Layer 2 fields — pass-through endpoints have no metrics', () => {
      const row = projectSourceRow(endpoint, { mode: 'endpoint' });
      expect('quads' in row).toBe(false);
      expect('files' in row).toBe(false);
      expect('loadedAt' in row).toBe(false);
      expect('loadMs' in row).toBe(false);
    });
  });
});

/*
 * Layer 3 (disk-backed extras, #357). Surfaces the on-disk **Glob index**
 * details on the **Sources page**: where it lives (`indexDir`), how much
 * space it takes (`indexBytes`), what sparqly built it (`manifestSparqlyVersion`),
 * and — for the `stale` state only — a human-readable mismatch reason.
 *
 * Layer 3 fields apply only to disk-backed rows; in-memory and endpoint rows
 * never carry them. The projector is a pure function — the caller (`projectEntryState`)
 * supplies the extras after reading the manifest / walking `indexDir`.
 */
describe('projectSourceRow — Layer 3 (disk-backed extras, #357)', () => {
  const DISK_EXTRAS = {
    indexDir: '/abs/.sparqly/index/big',
    indexBytes: 4_096_000,
    manifestSparqlyVersion: '0.29.0',
  } as const;

  describe('disk-backed mode', () => {
    it('emits indexDir, indexBytes, manifestSparqlyVersion on a ready row', () => {
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'ready',
        metrics: { files: 3, loadedAt: 1, loadMs: 42, quads: 100 },
        disk: DISK_EXTRAS,
      });
      expect(row).toMatchObject({
        mode: 'disk-backed',
        state: 'ready',
        indexDir: DISK_EXTRAS.indexDir,
        indexBytes: DISK_EXTRAS.indexBytes,
        manifestSparqlyVersion: DISK_EXTRAS.manifestSparqlyVersion,
        quads: 100,
      });
      // `staleReason` is the one Layer 3 field whose presence is gated on
      // state — `ready` never carries it.
      expect('staleReason' in row).toBe(false);
    });

    it("populates staleReason exactly when state is 'stale'", () => {
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'stale',
        disk: { ...DISK_EXTRAS, staleReason: 'matched file changed: /data/a.nq' },
      });
      expect(row).toMatchObject({
        mode: 'disk-backed',
        state: 'stale',
        indexDir: DISK_EXTRAS.indexDir,
        indexBytes: DISK_EXTRAS.indexBytes,
        manifestSparqlyVersion: DISK_EXTRAS.manifestSparqlyVersion,
        staleReason: 'matched file changed: /data/a.nq',
      });
    });

    for (const state of [
      'ready',
      'indexing',
      'not-built',
      'failed',
    ] as DiskBackedState[]) {
      it(`omits staleReason when state is '${state}' even if the disk extras carry one`, () => {
        // Defensive: the broker shouldn't pass a staleReason for a non-stale
        // state, but if it does, the projector strips it so the wire shape
        // can't lie about the state machine.
        const row = projectSourceRow(diskGlob, {
          mode: 'disk-backed',
          state,
          disk: { ...DISK_EXTRAS, staleReason: 'should not appear' },
        });
        expect('staleReason' in row).toBe(false);
      });
    }

    it('omits Layer 3 fields when the runtime carries no disk extras (legacy / pre-load)', () => {
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'not-built',
      });
      expect('indexDir' in row).toBe(false);
      expect('indexBytes' in row).toBe(false);
      expect('manifestSparqlyVersion' in row).toBe(false);
      expect('staleReason' in row).toBe(false);
    });

    it('emits Layer 3 extras on stale even without a metrics block', () => {
      // A stale disk-backed index isn't `ready` — the entry has no live load,
      // so there is no Layer 2 metrics block. Layer 3 still ships so the page
      // can show the user *which* index is stale, where it sits, and why.
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'stale',
        disk: { ...DISK_EXTRAS, staleReason: 'sparqly version changed' },
      });
      expect(row).toMatchObject({
        indexDir: DISK_EXTRAS.indexDir,
        indexBytes: DISK_EXTRAS.indexBytes,
        manifestSparqlyVersion: DISK_EXTRAS.manifestSparqlyVersion,
        staleReason: 'sparqly version changed',
      });
      expect('quads' in row).toBe(false);
      expect('files' in row).toBe(false);
    });
  });

  describe('in-memory mode', () => {
    it('never carries Layer 3 fields', () => {
      // Defensive: a runtime accidentally carrying `disk` extras on an in-
      // memory mode is rejected by the discriminated union at compile time;
      // at runtime the projector simply has no path that reads them.
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: { quads: 1, files: 1, loadedAt: 1, loadMs: 1 },
      });
      expect('indexDir' in row).toBe(false);
      expect('indexBytes' in row).toBe(false);
      expect('manifestSparqlyVersion' in row).toBe(false);
      expect('staleReason' in row).toBe(false);
    });
  });

  describe('endpoint mode', () => {
    it('never carries Layer 3 fields', () => {
      const row = projectSourceRow(endpoint, { mode: 'endpoint' });
      expect('indexDir' in row).toBe(false);
      expect('indexBytes' in row).toBe(false);
      expect('manifestSparqlyVersion' in row).toBe(false);
      expect('staleReason' in row).toBe(false);
    });
  });
});

/*
 * Layer 4 (endpoint extras, #359). Surfaces the endpoint URL on **Endpoint
 * source** rows of the **Sources page** so the operator can identify which
 * remote a row points at without round-tripping through `/api/config`.
 *
 * Layer 4 fields apply only to endpoint rows; in-memory and disk-backed rows
 * never carry them.
 */
describe('projectSourceRow — Layer 4 (endpoint extras, #359)', () => {
  it('emits endpointUrl on an endpoint row, copied from the source spec', async () => {
    const row = projectSourceRow(endpoint, { mode: 'endpoint' });
    expect(row).toEqual<SourceRow>({
      mode: 'endpoint',
      id: 'wikidata',
      kind: 'endpoint',
      endpointUrl: 'https://query.wikidata.org/sparql',
    });
  });

  it('preserves the default flag alongside endpointUrl', async () => {
    const row = projectSourceRow(
      { ...endpoint, default: true },
      { mode: 'endpoint' },
    );
    expect(row).toEqual<SourceRow>({
      mode: 'endpoint',
      id: 'wikidata',
      kind: 'endpoint',
      endpointUrl: 'https://query.wikidata.org/sparql',
      default: true,
    });
  });

  it('never appears on in-memory rows', async () => {
    const row = projectSourceRow(inMemoryGlob, {
      mode: 'in-memory',
      state: 'loaded',
      metrics: { quads: 1, files: 1, loadedAt: 1, loadMs: 1 },
    });
    expect('endpointUrl' in row).toBe(false);
  });

  it('never appears on disk-backed rows', async () => {
    const row = projectSourceRow(diskGlob, {
      mode: 'disk-backed',
      state: 'ready',
      metrics: { files: 1, loadedAt: 1, loadMs: 1 },
    });
    expect('endpointUrl' in row).toBe(false);
  });
});

/*
 * Layer 5 (failure surface, #360). Inline `error` chip on `failed` rows of the
 * **Sources page** — `kind` (the internal tag verbatim: 'glob-load',
 * 'inline-query-validation', 'index-build-failed', …), `message` (one-line summary),
 * `details` (optional full body — stderr tail for disk-backed builds; absent
 * for in-memory by default). The projector emits `error` exactly when the
 * runtime is `failed` — never on any other state, even if the runtime
 * accidentally carries one — so the wire shape can never lie about the state
 * machine, mirroring the Layer 3 staleReason gating.
 */
describe('projectSourceRow — Layer 5 (failure surface, #360)', () => {
  const IN_MEMORY_ERROR = {
    kind: 'glob-load',
    message: 'Failed to parse /abs/docs/broken.ttl: Unexpected ":"',
  } as const;
  const DISK_BACKED_ERROR = {
    kind: 'index-build-failed',
    message: 'exit code 1',
    details: 'last 4KB of stderr…\nError: bad triple at line 42',
  } as const;

  describe('in-memory mode', () => {
    it("emits error on a failed row with the SourceError's kind and message", () => {
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'failed',
        error: IN_MEMORY_ERROR,
      });
      expect(row).toEqual<SourceRow>({
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'failed',
        error: IN_MEMORY_ERROR,
      });
    });

    for (const state of [
      'not-loaded',
      'loading',
      'loaded',
    ] as InMemoryState[]) {
      it(`omits error when state is '${state}' even if runtime carries one`, () => {
        const row = projectSourceRow(inMemoryGlob, {
          mode: 'in-memory',
          state,
          error: IN_MEMORY_ERROR,
        });
        expect('error' in row).toBe(false);
      });
    }

    it('omits error when failed but the runtime carries no error block', () => {
      // Defensive: a failed runtime without an error block is a server bug,
      // but the projector treats it as "no chip" rather than synthesizing a
      // placeholder — the wire never lies about the absence of details.
      const row = projectSourceRow(inMemoryGlob, {
        mode: 'in-memory',
        state: 'failed',
      });
      expect('error' in row).toBe(false);
    });
  });

  describe('disk-backed mode', () => {
    it('emits error on a failed disk-backed row including details (stderr tail)', () => {
      const row = projectSourceRow(diskGlob, {
        mode: 'disk-backed',
        state: 'failed',
        error: DISK_BACKED_ERROR,
        disk: { indexDir: '/abs/.sparqly/index/big' },
      });
      expect(row).toMatchObject({
        mode: 'disk-backed',
        state: 'failed',
        error: DISK_BACKED_ERROR,
        indexDir: '/abs/.sparqly/index/big',
      });
    });

    for (const state of [
      'not-built',
      'indexing',
      'ready',
      'stale',
    ] as DiskBackedState[]) {
      it(`omits error when disk-backed state is '${state}' even if runtime carries one`, () => {
        const row = projectSourceRow(diskGlob, {
          mode: 'disk-backed',
          state,
          error: DISK_BACKED_ERROR,
        });
        expect('error' in row).toBe(false);
      });
    }
  });

  describe('endpoint mode', () => {
    it('never carries an error field — endpoint probe results ride a separate channel', () => {
      // Endpoint failures surface via the `Test connection` chip
      // (`POST /api/sources/:id/test-connection`), not via the row's `error`
      // field — there is no per-endpoint persistent failure state in the
      // row schema. The discriminated union forbids `error` on endpoint at
      // compile time; this is a runtime sanity check.
      const row = projectSourceRow(endpoint, { mode: 'endpoint' });
      expect('error' in row).toBe(false);
    });
  });
});

/*
 * Split-glob meta-row aggregation (#361). A **Split glob** renders as a single
 * disclosable meta row that aggregates its synthesized **File source** children
 * — so a glob matching 200 files does not drown the **Sources page**. The meta
 * row carries:
 *   - an aggregated state: the common child state when every child agrees,
 *     `'mixed'` when they disagree, the meta's own runtime state when there
 *     are no children;
 *   - a Layer 2 metric summary: `quads` summed across children that report a
 *     value; `files` = count of children currently in a loaded/ready state;
 *     `loadedAt` = max child `loadedAt`; `loadMs` omitted (heterogeneous);
 *   - `children: SourceRow[]` carrying each child's own state, metrics, error,
 *     and id verbatim (already-projected by `projectSourceRow`).
 *
 * The projector is pure — the caller (snapshot controller) walks the parsed
 * registry, projects children first, then asks `projectSplitGlobMeta` for the
 * meta row.
 */
describe('projectSplitGlobMeta — Split glob disclosure (#361)', () => {
  const splitMeta: ParsedSource = {
    kind: 'glob',
    id: 'docs',
    glob: 'docs/**/*.ttl',
    splitByFile: true,
  };

  const childA: ParsedSource = {
    kind: 'file',
    id: 'docs/a.ttl',
    path: '/abs/docs/a.ttl',
    parentId: 'docs',
  };
  const childB: ParsedSource = {
    kind: 'file',
    id: 'docs/b.ttl',
    path: '/abs/docs/b.ttl',
    parentId: 'docs',
  };

  it('returns a meta row with empty children when the split glob has no matched files', () => {
    // ADR-0028: a zero-match split glob is a `warn`, not an error — the meta
    // is still a registry entry and must still appear as a row.
    const row = projectSplitGlobMeta(
      splitMeta,
      { mode: 'in-memory', state: 'not-loaded' },
      [],
    );
    expect(row).toEqual<SourceRow>({
      mode: 'in-memory',
      id: 'docs',
      kind: 'glob',
      state: 'not-loaded',
      children: [],
    });
  });

  it("carries the common child state when every child agrees ('loaded' across the board)", () => {
    const childRows: SourceRow[] = [
      projectSourceRow(childA, { mode: 'in-memory', state: 'loaded' }),
      projectSourceRow(childB, { mode: 'in-memory', state: 'loaded' }),
    ];
    const row = projectSplitGlobMeta(
      splitMeta,
      // Whatever the meta's own runtime says, the children's unanimous state
      // wins — the meta row is a *summary*, not an independent state machine.
      { mode: 'in-memory', state: 'not-loaded' },
      childRows,
    );
    if (row.mode !== 'in-memory') throw new Error('narrow');
    expect(row.state).toBe('loaded');
    expect(row.children).toEqual(childRows);
  });

  it("carries state 'mixed' when children disagree (parent union untouched)", () => {
    const childRows: SourceRow[] = [
      projectSourceRow(childA, { mode: 'in-memory', state: 'loaded' }),
      projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
    ];
    // Parent union not directly queried, so the per-file children drive the row.
    const row = projectSplitGlobMeta(
      splitMeta,
      { mode: 'in-memory', state: 'not-loaded' },
      childRows,
    );
    if (row.mode !== 'in-memory') throw new Error('narrow');
    expect(row.state).toBe('mixed');
  });

  it('summarizes Layer 2 metrics across loaded children — sum quads, count loaded files, max loadedAt', () => {
    // Each File source child is its own materialization; the meta has no
    // independent metric block. The summary is what the operator wants at a
    // glance: how many quads sit under this glob in total, how many files have
    // been loaded so far, when was the most recent.
    const childRows: SourceRow[] = [
      projectSourceRow(childA, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: { quads: 100, files: 1, loadedAt: 1_700_000_000_000, loadMs: 10 },
      }),
      projectSourceRow(childB, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: { quads: 250, files: 1, loadedAt: 1_700_000_100_000, loadMs: 20 },
      }),
    ];
    // Children loaded individually (per-file workflow); the parent union itself
    // was never directly queried, so it stays not-loaded and the children win.
    const row = projectSplitGlobMeta(
      splitMeta,
      { mode: 'in-memory', state: 'not-loaded' },
      childRows,
    );
    expect(row).toMatchObject({
      mode: 'in-memory',
      id: 'docs',
      state: 'loaded',
      quads: 350,
      files: 2,
      loadedAt: 1_700_000_100_000,
    });
    // loadMs is heterogeneous across children — no meaningful single value.
    expect('loadMs' in row).toBe(false);
  });

  it('omits Layer 2 fields entirely when no child is loaded yet', () => {
    const childRows: SourceRow[] = [
      projectSourceRow(childA, { mode: 'in-memory', state: 'not-loaded' }),
      projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
    ];
    const row = projectSplitGlobMeta(
      splitMeta,
      { mode: 'in-memory', state: 'not-loaded' },
      childRows,
    );
    expect('quads' in row).toBe(false);
    expect('files' in row).toBe(false);
    expect('loadedAt' in row).toBe(false);
    expect('loadMs' in row).toBe(false);
  });

  it('counts only loaded children in `files`; ignores not-loaded siblings in the totals', () => {
    const childRows: SourceRow[] = [
      projectSourceRow(childA, {
        mode: 'in-memory',
        state: 'loaded',
        metrics: { quads: 42, files: 1, loadedAt: 1, loadMs: 1 },
      }),
      projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
    ];
    const row = projectSplitGlobMeta(
      splitMeta,
      { mode: 'in-memory', state: 'not-loaded' },
      childRows,
    );
    expect(row).toMatchObject({ quads: 42, files: 1, loadedAt: 1 });
  });

  it('omits `quads` from the summary when no loaded child reports quads (forward-compat with quadCount-less manifests)', () => {
    // ADR amendment to **Glob index**: `quadCount` is forward-compatible additive.
    // A disk-backed `ready` child without a manifest `quadCount` carries
    // `quads: undefined`, so the meta sum has no defined number to report.
    const diskChildA: ParsedSource = {
      kind: 'file',
      id: 'big/a.nq',
      path: '/abs/data/a.nq',
      parentId: 'big',
      storage: 'disk',
    };
    const childRow = projectSourceRow(diskChildA, {
      mode: 'disk-backed',
      state: 'ready',
      metrics: { files: 1, loadedAt: 1, loadMs: 1 },
    });
    const row = projectSplitGlobMeta(
      { ...splitMeta, id: 'big', storage: 'disk' },
      { mode: 'disk-backed', state: 'ready' },
      [childRow],
    );
    expect(row).toMatchObject({ files: 1, loadedAt: 1 });
    expect('quads' in row).toBe(false);
  });

  // The split-glob parent is itself a queryable union (`?source=<id>`), a
  // residency distinct from its per-file children. When that union is directly
  // loaded the meta must reflect it as `loaded` — otherwise a parent-union query
  // leaves the Sources row reading `not-loaded` while the store is resident and
  // serving instant queries (the reported worker-era symptom; pre-existing).
  describe('parent-union residency (parent state wins when loaded)', () => {
    it("surfaces 'loaded' with the parent's union metrics even when no child has been individually loaded", () => {
      const childRows: SourceRow[] = [
        projectSourceRow(childA, { mode: 'in-memory', state: 'not-loaded' }),
        projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
      ];
      const row = projectSplitGlobMeta(
        splitMeta,
        {
          mode: 'in-memory',
          state: 'loaded',
          metrics: { quads: 500, files: 2, loadedAt: 1_700_000_200_000, loadMs: 7 },
        },
        childRows,
      );
      if (row.mode !== 'in-memory') throw new Error('narrow');
      expect(row.state).toBe('loaded');
      // The union's own metrics win — not the (empty) child summary.
      expect(row).toMatchObject({
        quads: 500,
        files: 2,
        loadedAt: 1_700_000_200_000,
        loadMs: 7,
      });
      // Children stay as the per-file breakdown.
      expect(row.children).toEqual(childRows);
    });

    it("stays 'loaded' when the parent union is loaded alongside some loaded children", () => {
      const childRows: SourceRow[] = [
        projectSourceRow(childA, {
          mode: 'in-memory',
          state: 'loaded',
          metrics: { quads: 100, files: 1, loadedAt: 1, loadMs: 1 },
        }),
        projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
      ];
      const row = projectSplitGlobMeta(
        splitMeta,
        {
          mode: 'in-memory',
          state: 'loaded',
          metrics: { quads: 500, files: 2, loadedAt: 9, loadMs: 7 },
        },
        childRows,
      );
      if (row.mode !== 'in-memory') throw new Error('narrow');
      // Parent union wins over the mixed children that would otherwise be 'mixed'.
      expect(row.state).toBe('loaded');
      expect(row).toMatchObject({ quads: 500, files: 2 });
    });

    it("surfaces 'loading' while the parent union is mid-load, not the children's not-loaded", () => {
      const childRows: SourceRow[] = [
        projectSourceRow(childA, { mode: 'in-memory', state: 'not-loaded' }),
        projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
      ];
      const row = projectSplitGlobMeta(
        splitMeta,
        { mode: 'in-memory', state: 'loading' },
        childRows,
      );
      if (row.mode !== 'in-memory') throw new Error('narrow');
      expect(row.state).toBe('loading');
      expect(row.children).toEqual(childRows);
    });

    it("surfaces 'failed' (with the error) when the parent union load fails", () => {
      const childRows: SourceRow[] = [
        projectSourceRow(childA, { mode: 'in-memory', state: 'not-loaded' }),
        projectSourceRow(childB, { mode: 'in-memory', state: 'not-loaded' }),
      ];
      const row = projectSplitGlobMeta(
        splitMeta,
        {
          mode: 'in-memory',
          state: 'failed',
          error: { kind: 'glob-load', message: 'parse blew up' },
        },
        childRows,
      );
      if (row.mode !== 'in-memory') throw new Error('narrow');
      expect(row.state).toBe('failed');
      expect(row.error).toEqual({ kind: 'glob-load', message: 'parse blew up' });
    });
  });
});
