import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { SourceRow } from './models/source-row';
import { SourcesPage } from './sources.page';
import { SourcesRegistryService } from './services/sources-registry.service';

/**
 * Stub registry — the page reads `rows` and `allowAdminActions` from it;
 * everything else (HTTP, SSE, config) belongs to the real service and is
 * covered by `sources-registry.service.spec.ts`.
 */
@Injectable()
class StubRegistry {
  readonly rows = signal<SourceRow[] | null>(null);
  readonly allowAdminActions = signal(true);
}

const splitMeta: SourceRow = {
  mode: 'in-memory',
  id: 'docs',
  kind: 'glob',
  state: 'mixed',
  children: [
    {
      mode: 'in-memory',
      id: 'docs/a.ttl',
      kind: 'file',
      state: 'loaded',
      parentId: 'docs',
    },
    {
      mode: 'in-memory',
      id: 'docs/b.ttl',
      kind: 'file',
      state: 'not-loaded',
      parentId: 'docs',
    },
  ],
};
const projects: SourceRow = {
  mode: 'in-memory',
  id: 'projects',
  kind: 'glob',
  state: 'loaded',
};
const big: SourceRow = {
  mode: 'disk-backed',
  id: 'big',
  kind: 'glob',
  state: 'ready',
};
const wikidata: SourceRow = {
  mode: 'endpoint',
  id: 'wikidata',
  kind: 'endpoint',
};

/**
 * Instantiates `SourcesPage` with a stubbed registry. We create the
 * component (so DI runs) but never call `detectChanges` — we only read
 * the class's signals and methods. No DOM rendering, no DOM queries.
 */
function setup(initialRows: SourceRow[] | null = null) {
  TestBed.configureTestingModule({});
  TestBed.overrideComponent(SourcesPage, {
    set: {
      providers: [{ provide: SourcesRegistryService, useClass: StubRegistry }],
    },
  });
  const fixture = TestBed.createComponent(SourcesPage);
  const registry = fixture.debugElement.injector.get(
    SourcesRegistryService,
  ) as unknown as StubRegistry;
  registry.rows.set(initialRows);
  return { page: fixture.componentInstance, registry };
}

describe('SourcesPage', () => {
  describe('displayRows', () => {
    it('returns null while the registry snapshot is still pending', () => {
      const { page } = setup(null);
      expect(page.displayRows()).toBeNull();
    });

    it('does not splice children of a collapsed meta-row', () => {
      const { page } = setup([splitMeta, projects]);
      expect(page.displayRows()?.map((r) => r.id)).toEqual([
        'docs',
        'projects',
      ]);
    });

    it('splices children directly after an expanded meta-row when toggled', () => {
      const { page } = setup([splitMeta, projects]);
      page.toggleMeta('docs');
      expect(page.displayRows()?.map((r) => r.id)).toEqual([
        'docs',
        'docs/a.ttl',
        'docs/b.ttl',
        'projects',
      ]);
    });

    it('toggleMeta is idempotent — second call collapses again', () => {
      const { page } = setup([splitMeta]);
      page.toggleMeta('docs');
      page.toggleMeta('docs');
      expect(page.displayRows()?.map((r) => r.id)).toEqual(['docs']);
    });
  });

  describe('counts', () => {
    it('counts every row + child regardless of expansion', () => {
      const { page } = setup([splitMeta, projects, big, wikidata]);
      const c = page.counts();
      expect(c.all).toBe(6); // 4 top-level + 2 children
      expect(c.endpoint).toBe(1);
      expect(c.loaded).toBe(2); // projects + docs/a.ttl
      expect(c['not-loaded']).toBe(1); // docs/b.ttl
      expect(c.ready).toBe(1); // big
    });

    it('returns a fully-zeroed object while rows are null', () => {
      const { page } = setup(null);
      expect(page.counts().all).toBe(0);
    });
  });

  describe('visibleRows', () => {
    it('returns [] while rows are null', () => {
      const { page } = setup(null);
      expect(page.visibleRows()).toEqual([]);
    });

    it('narrows by case-insensitive id substring', () => {
      const { page } = setup([splitMeta, projects, big, wikidata]);
      page.query.set('PRO');
      expect(page.visibleRows().map((r) => r.id)).toEqual(['projects']);
    });

    it('"endpoint" filter keeps only endpoint rows', () => {
      const { page } = setup([splitMeta, projects, big, wikidata]);
      page.state.set('endpoint');
      expect(page.visibleRows().map((r) => r.id)).toEqual(['wikidata']);
    });

    it('a state filter excludes endpoint rows', () => {
      const { page } = setup([splitMeta, projects, big, wikidata]);
      page.state.set('loaded');
      expect(page.visibleRows().map((r) => r.id)).toEqual(['projects']);
    });

    it('combines query + state filters', () => {
      const { page } = setup([splitMeta, projects, big, wikidata]);
      page.query.set('pr');
      page.state.set('loaded');
      expect(page.visibleRows().map((r) => r.id)).toEqual(['projects']);
    });

    it('children of an expanded meta-row participate in the visible list', () => {
      const { page } = setup([splitMeta]);
      page.toggleMeta('docs');
      page.state.set('loaded');
      expect(page.visibleRows().map((r) => r.id)).toEqual(['docs/a.ttl']);
    });
  });

  describe('isInExpandedGroup', () => {
    it('returns false for a collapsed meta-row', () => {
      const { page } = setup([splitMeta]);
      expect(page.isInExpandedGroup(splitMeta)).toBe(false);
    });

    it('returns true for an expanded meta-row and its children', () => {
      const { page } = setup([splitMeta]);
      page.toggleMeta('docs');
      expect(page.isInExpandedGroup(splitMeta)).toBe(true);
      expect(page.isInExpandedGroup(splitMeta.children![0])).toBe(true);
    });

    it('returns false for endpoint rows', () => {
      const { page } = setup([wikidata]);
      expect(page.isInExpandedGroup(wikidata)).toBe(false);
    });
  });

  describe('isMetaExpanded', () => {
    it('tracks the toggled-meta set', () => {
      const { page } = setup([splitMeta]);
      expect(page.isMetaExpanded('docs')).toBe(false);
      page.toggleMeta('docs');
      expect(page.isMetaExpanded('docs')).toBe(true);
      page.toggleMeta('docs');
      expect(page.isMetaExpanded('docs')).toBe(false);
    });
  });

  describe('passthroughs from the registry', () => {
    it('exposes rows from the registry signal', () => {
      const { page, registry } = setup([projects]);
      expect(page.rows()).toEqual([projects]);
      registry.rows.set([projects, big]);
      expect(page.rows()).toEqual([projects, big]);
    });

    it('exposes allowAdminActions from the registry signal', () => {
      const { page, registry } = setup([]);
      expect(page.allowAdminActions()).toBe(true);
      registry.allowAdminActions.set(false);
      expect(page.allowAdminActions()).toBe(false);
    });
  });
});
