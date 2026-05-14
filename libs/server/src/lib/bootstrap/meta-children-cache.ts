import {
  defaultGlobWalker,
  expandSplitGlobs,
  type ExpandSplitGlobsDeps,
  type ParsedFileSource,
  type ParsedGlobSource,
  type ParsedSource,
} from 'core';
import type { SparqlyLogger } from 'common';

interface Entry {
  meta: ParsedGlobSource;
  children: ReadonlyArray<ParsedFileSource>;
  dirty: boolean;
}

/**
 * Per-meta children cache for `splitByFile: true` glob sources (ADR-0027).
 *
 * Seeded from the registry returned by `expandSplitGlobs` at server boot.
 * The watcher calls `invalidate(parentId)` on file add/remove inside a
 * split-glob pattern; the next `getChildren(parentId)` re-walks the meta's
 * glob and yields the current children.
 */
export class MetaChildrenCache {
  private readonly entries = new Map<string, Entry>();
  private readonly walker: ExpandSplitGlobsDeps['walkGlob'];
  private readonly logger: SparqlyLogger | undefined;

  constructor(
    parsedRegistry: ReadonlyArray<ParsedSource>,
    deps?: { walkGlob?: ExpandSplitGlobsDeps['walkGlob']; logger?: SparqlyLogger },
  ) {
    this.walker = deps?.walkGlob ?? defaultGlobWalker;
    this.logger = deps?.logger;

    const childrenByParent = new Map<string, ParsedFileSource[]>();
    for (const src of parsedRegistry) {
      if (src.kind !== 'file') continue;
      const arr = childrenByParent.get(src.parentId) ?? [];
      arr.push(src);
      childrenByParent.set(src.parentId, arr);
    }
    for (const src of parsedRegistry) {
      if (src.kind !== 'glob' || src.splitByFile !== true) continue;
      if (src.id === undefined) continue;
      this.entries.set(src.id, {
        meta: src,
        children: childrenByParent.get(src.id) ?? [],
        dirty: false,
      });
    }
  }

  hasParent(parentId: string): boolean {
    return this.entries.has(parentId);
  }

  invalidate(parentId: string): void {
    const entry = this.entries.get(parentId);
    if (!entry) return;
    entry.dirty = true;
  }

  async getChildren(
    parentId: string,
  ): Promise<ReadonlyArray<ParsedFileSource>> {
    const entry = this.entries.get(parentId);
    if (!entry) return [];
    if (!entry.dirty) return entry.children;
    const expanded = await expandSplitGlobs([entry.meta], {
      walkGlob: this.walker,
      logger: this.logger,
    });
    entry.children = expanded.filter(
      (s): s is ParsedFileSource => s.kind === 'file',
    );
    entry.dirty = false;
    return entry.children;
  }
}
