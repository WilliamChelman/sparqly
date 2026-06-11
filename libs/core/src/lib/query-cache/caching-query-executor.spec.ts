import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { ExecuteOptions, ExecuteResult, QueryExecutor } from '../engine';
import type {
  EndpointFetchError,
  QueryExecutionError,
} from '../sources/errors';
import type {
  CachedResult,
  QueryCache,
  QueryCacheSetMeta,
} from './cache-store';
import { CachingQueryExecutor } from './caching-query-executor';

/**
 * The read-through seam (ADR-0054, #413) wraps any {@link QueryExecutor}. These
 * tests drive it through the public `QueryExecutor` surface against a fake
 * in-memory store and a call-counting delegate — no SQLite, no real engine — so
 * they assert the seam's behavior (serve a hit without re-execution; never cache
 * an error; do cache an empty body) independent of either collaborator.
 */
describe('CachingQueryExecutor', () => {
  /** A Map-backed {@link QueryCache} standing in for the on-disk store. */
  function fakeCache(): QueryCache {
    const map = new Map<string, CachedResult>();
    return {
      get: (key) => map.get(key),
      set: (key, body, meta: QueryCacheSetMeta) =>
        void map.set(key, {
          body,
          format: meta.format,
          contentType: meta.contentType,
        }),
      close: () => undefined,
    };
  }

  /** A delegate that counts executions and returns a scripted outcome. */
  function delegate(
    outcome:
      | { ok: ExecuteResult }
      | { err: QueryExecutionError | EndpointFetchError },
  ): QueryExecutor & { calls: number } {
    const exec = {
      calls: 0,
      executeResult(
        _query: string,
        _options?: ExecuteOptions,
      ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
        exec.calls++;
        return 'ok' in outcome ? okAsync(outcome.ok) : errAsync(outcome.err);
      },
      async execute(
        query: string,
        options?: ExecuteOptions,
      ): Promise<ExecuteResult> {
        const r = await exec.executeResult(query, options);
        return r.match(
          (ok) => ok,
          (err) => {
            throw new Error(err.message);
          },
        );
      },
    };
    return exec;
  }

  function jsonResult(body: string): ExecuteResult {
    return {
      body,
      format: 'json',
      contentType: 'application/sparql-results+json',
    };
  }

  function seam(
    inner: QueryExecutor,
    cache: QueryCache,
    overrides: Partial<{
      sourceId: string;
      mode: 'normal' | 'bypass';
      freshnessToken: string;
    }> = {},
  ): CachingQueryExecutor {
    return new CachingQueryExecutor({
      delegate: inner,
      cache,
      sourceId: overrides.sourceId ?? 'endpoint-1',
      contextDigest: 'ctx',
      freshnessToken: overrides.freshnessToken ?? '',
      schemaVersion: '1',
      mode: overrides.mode ?? 'normal',
    });
  }

  const QUERY = 'SELECT * WHERE { ?s ?p ?o }';

  it('serves a repeated identical query from the cache without re-executing', async () => {
    const inner = delegate({ ok: jsonResult('{"rows":1}') });
    const s = seam(inner, fakeCache());

    const first = (await s.executeResult(QUERY))._unsafeUnwrap();
    const second = (await s.executeResult(QUERY))._unsafeUnwrap();

    expect(inner.calls).toBe(1);
    expect(first.cacheStatus).toBe('miss');
    expect(second.cacheStatus).toBe('hit');
    expect(second.body).toBe('{"rows":1}');
  });

  it('never caches an errored execution: a later identical query re-executes', async () => {
    const inner = delegate({
      err: { kind: 'endpoint-fetch', endpoint: 'http://x', message: 'boom' },
    });
    const s = seam(inner, fakeCache());

    const first = await s.executeResult(QUERY);
    const second = await s.executeResult(QUERY);

    expect(first.isErr()).toBe(true);
    expect(second.isErr()).toBe(true);
    expect(inner.calls).toBe(2); // not served from cache
  });

  it('caches an empty result body: a later identical query is a hit', async () => {
    const inner = delegate({ ok: jsonResult('') });
    const s = seam(inner, fakeCache());

    await s.executeResult(QUERY);
    const second = (await s.executeResult(QUERY))._unsafeUnwrap();

    expect(inner.calls).toBe(1);
    expect(second.cacheStatus).toBe('hit');
    expect(second.body).toBe('');
  });

  it('treats a different query text as a miss (key threads the query)', async () => {
    const inner = delegate({ ok: jsonResult('x') });
    const s = seam(inner, fakeCache());

    await s.executeResult(QUERY);
    const other = (
      await s.executeResult('SELECT * WHERE { ?a ?b ?c }')
    )._unsafeUnwrap();

    expect(inner.calls).toBe(2);
    expect(other.cacheStatus).toBe('miss');
  });

  it('distinguishes two sources sharing one store (key threads the source id)', async () => {
    const cache = fakeCache();
    const a = seam(delegate({ ok: jsonResult('A') }), cache, { sourceId: 'a' });
    const b = seam(delegate({ ok: jsonResult('B') }), cache, { sourceId: 'b' });

    await a.executeResult(QUERY);
    const fromB = (await b.executeResult(QUERY))._unsafeUnwrap();

    expect(fromB.cacheStatus).toBe('miss'); // not a's cached body
    expect(fromB.body).toBe('B');
  });

  it('recomputes when the freshness token changes (underlying content edited)', async () => {
    const cache = fakeCache();
    const before = seam(delegate({ ok: jsonResult('OLD') }), cache, {
      sourceId: 'glob-1',
      freshnessToken: 'stat:before',
    });
    const after = seam(delegate({ ok: jsonResult('NEW') }), cache, {
      sourceId: 'glob-1',
      freshnessToken: 'stat:after',
    });

    await before.executeResult(QUERY);
    const recomputed = (await after.executeResult(QUERY))._unsafeUnwrap();

    expect(recomputed.cacheStatus).toBe('miss'); // a stale entry is not served
    expect(recomputed.body).toBe('NEW');
  });

  it('forwards the resolved per-entry ttl to the store on a miss (per-source override)', async () => {
    const captured: QueryCacheSetMeta[] = [];
    const cache: QueryCache = {
      get: () => undefined,
      set: (_k, _b, meta) => void captured.push(meta),
      close: () => undefined,
    };
    const s = new CachingQueryExecutor({
      delegate: delegate({ ok: jsonResult('x') }),
      cache,
      sourceId: 'endpoint-1',
      contextDigest: 'ctx',
      freshnessToken: '',
      schemaVersion: '1',
      entryTtlMs: 30 * 60 * 1000,
    });

    await s.executeResult(QUERY);

    expect(captured[0]?.ttlMs).toBe(30 * 60 * 1000);
  });

  it('never caches a non-deterministic query (NOW): every call executes live', async () => {
    const inner = delegate({ ok: jsonResult('z') });
    const s = seam(inner, fakeCache()); // normal mode

    const first = (
      await s.executeResult('SELECT (NOW() AS ?t) WHERE { ?s ?p ?o }')
    )._unsafeUnwrap();
    const second = (
      await s.executeResult('SELECT (NOW() AS ?t) WHERE { ?s ?p ?o }')
    )._unsafeUnwrap();

    expect(inner.calls).toBe(2); // not served from cache the second time
    expect(first.cacheStatus).toBe('bypass');
    expect(second.cacheStatus).toBe('bypass');
  });

  it('a per-request cacheMode refresh re-executes and replaces the stored entry (#418)', async () => {
    const cache = fakeCache();
    let upstream = 'OLD';
    const inner = {
      calls: 0,
      executeResult(): ResultAsync<
        ExecuteResult,
        QueryExecutionError | EndpointFetchError
      > {
        inner.calls++;
        return okAsync(jsonResult(upstream));
      },
      async execute(): Promise<ExecuteResult> {
        inner.calls++;
        return jsonResult(upstream);
      },
    };
    const s = seam(inner, cache); // instance mode stays 'normal'

    await s.executeResult(QUERY); // warm: stores OLD
    upstream = 'NEW';

    const refreshed = (
      await s.executeResult(QUERY, { cacheMode: 'refresh' })
    )._unsafeUnwrap();
    expect(inner.calls).toBe(2); // the stored entry was ignored
    expect(refreshed.cacheStatus).toBe('miss');
    expect(refreshed.body).toBe('NEW');

    const after = (await s.executeResult(QUERY))._unsafeUnwrap();
    expect(after.cacheStatus).toBe('hit');
    expect(after.body).toBe('NEW'); // replaced, not the stale OLD
  });

  it('in bypass mode neither reads nor writes the cache', async () => {
    const inner = delegate({ ok: jsonResult('y') });
    const s = seam(inner, fakeCache(), { mode: 'bypass' });

    const first = (await s.executeResult(QUERY))._unsafeUnwrap();
    const second = (await s.executeResult(QUERY))._unsafeUnwrap();

    expect(inner.calls).toBe(2); // every call executes
    expect(first.cacheStatus).toBe('bypass');
    expect(second.cacheStatus).toBe('bypass');
  });
});
