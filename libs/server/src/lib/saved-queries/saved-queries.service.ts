import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ParameterDeclaration } from 'common';
import {
  atomicWriteFile,
  deriveEntryEtag,
  getEntry,
  listEntries,
  parseSidecar,
  removeEntry,
  type SavedQueryEntry,
  type SavedQueryEntrySummary,
  serializeSidecar,
  upsertEntry,
} from 'core';

export interface SavedQueriesConfig {
  path: string;
}

/**
 * Process-wide write mutex (ADR-0036). All mutations queue behind the previous
 * one so concurrent PUTs serialize and the on-disk file is never half-written.
 * Reads are not gated: they parse the file in isolation per request.
 */
export class SavedQueriesService {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: SavedQueriesConfig) {}

  async list(): Promise<ReadonlyArray<SavedQueryEntrySummary>> {
    const doc = await this.loadDoc();
    return listEntries(doc);
  }

  async get(
    slug: string,
  ): Promise<{ entry: SavedQueryEntry; etag: string } | undefined> {
    const doc = await this.loadDoc();
    const entry = getEntry(doc, slug);
    if (!entry) return undefined;
    return { entry, etag: deriveEntryEtag(entry) };
  }

  async put(
    slug: string,
    payload: {
      description?: string;
      body: string;
      parameters?: ReadonlyArray<ParameterDeclaration>;
    },
    ifMatch: string | undefined,
  ): Promise<
    | { kind: 'created'; etag: string }
    | { kind: 'updated'; etag: string }
    | { kind: 'collision' }
    | { kind: 'stale' }
  > {
    return this.runExclusive(async () => {
      const doc = await this.loadDoc();
      const existing = getEntry(doc, slug);
      if (existing) {
        if (ifMatch === undefined) return { kind: 'collision' as const };
        if (ifMatch !== deriveEntryEtag(existing)) {
          return { kind: 'stale' as const };
        }
      }
      const entry: SavedQueryEntry = { slug, body: payload.body };
      if (payload.description !== undefined) {
        entry.description = payload.description;
      }
      if (payload.parameters !== undefined) {
        entry.parameters = [...payload.parameters];
      }
      const result = upsertEntry(doc, entry);
      await atomicWriteFile(this.config.path, serializeSidecar(doc));
      const etag = deriveEntryEtag(entry);
      return result.created
        ? { kind: 'created' as const, etag }
        : { kind: 'updated' as const, etag };
    });
  }

  async delete(
    slug: string,
    ifMatch: string | undefined,
  ): Promise<'deleted' | 'missing' | 'stale' | 'precondition-required'> {
    return this.runExclusive(async () => {
      if (ifMatch === undefined) return 'precondition-required' as const;
      const doc = await this.loadDoc();
      const existing = getEntry(doc, slug);
      if (!existing) return 'missing' as const;
      if (ifMatch !== deriveEntryEtag(existing)) return 'stale' as const;
      removeEntry(doc, slug);
      await atomicWriteFile(this.config.path, serializeSidecar(doc));
      return 'deleted' as const;
    });
  }

  private async loadDoc() {
    if (!existsSync(this.config.path)) {
      return parseSidecar('savedQueries: {}\n');
    }
    const text = await readFile(this.config.path, 'utf8');
    return parseSidecar(text);
  }

  private runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(work, work);
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}
