import { describe, expect, it } from 'vitest';
import type { ParsedSource } from 'core';
import {
  projectSourceRow,
  type DiskBackedState,
  type InMemoryState,
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

const view: ParsedSource = {
  kind: 'view',
  id: 'view-a',
  from: '@docs',
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
    for (const source of [inMemoryGlob, splitChild, view, empty]) {
      for (const state of IN_MEMORY_STATES) {
        it(`projects ${source.kind} '${source.id}' with state '${state}'`, () => {
          const runtime: SourceRuntime = { mode: 'in-memory', state };
          const row = projectSourceRow(source, runtime);
          const expected: SourceRow = {
            mode: 'in-memory',
            id: source.id as string,
            kind: source.kind as 'glob' | 'file' | 'view' | 'empty',
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
