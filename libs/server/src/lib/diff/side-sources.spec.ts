import { describe, expect, it } from 'vitest';
import type * as RDF from '@rdfjs/types';
import { Store } from 'n3';
import {
  rejectDiskBackedQuerySources,
  type LoadedLikeSources,
} from './side-sources';
import type { QuerySources } from 'core';

const fakeRdfSource: RDF.Source = {
  match: () => {
    throw new Error('not used');
  },
} as unknown as RDF.Source;

describe('rejectDiskBackedQuerySources', () => {
  it('returns a typed `glob-load` err for a disk-backed QuerySources and releases its LevelDB lock', async () => {
    let closeCalls = 0;
    const sources: QuerySources = {
      mode: 'disk-backed',
      source: fakeRdfSource,
      files: ['/tmp/a.ttl'],
      indexDir: '/tmp/.sparqly/idx',
      close: async () => {
        closeCalls += 1;
      },
    };

    const result = rejectDiskBackedQuerySources(sources);

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.kind).toBe('glob-load');
    if (result.error.kind !== 'glob-load') return;
    expect(result.error.message).toMatch(/disk-backed/);
    // Wait one microtask so the async close() promise the reject path
    // launched has a chance to settle — verifying the lock is released.
    await Promise.resolve();
    expect(closeCalls).toBe(1);
  });

  it('passes a materialized QuerySources through unchanged', () => {
    const store = new Store();
    const sources: QuerySources = {
      mode: 'materialized',
      store,
      files: [],
      prefixes: {},
    };

    const result = rejectDiskBackedQuerySources(sources);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const ok = result.value as LoadedLikeSources;
    expect(ok.mode).toBe('materialized');
    if (ok.mode !== 'materialized') return;
    expect(ok.store).toBe(store);
  });

  it('passes a pass-through endpoint QuerySources through unchanged', () => {
    const sources: QuerySources = {
      mode: 'pass-through',
      endpoint: {
        kind: 'endpoint',
        id: 'remote',
        endpoint: 'https://example.org/sparql',
      },
    };

    const result = rejectDiskBackedQuerySources(sources);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const ok = result.value as LoadedLikeSources;
    expect(ok.mode).toBe('pass-through');
    if (ok.mode !== 'pass-through') return;
    expect(ok.endpoint.endpoint).toBe('https://example.org/sparql');
  });
});
