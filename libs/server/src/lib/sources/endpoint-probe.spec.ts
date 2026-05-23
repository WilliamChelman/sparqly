import { okAsync, errAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { ExecuteResult, QueryEngine } from 'core';
import { probeEndpoint, type ProbeEngine } from './endpoint-probe';

/**
 * Tiny stub matching the structural slice of `QueryEngine` the probe uses:
 * `executeResult(query, options)` returning a `ResultAsync` of an
 * `ExecuteResult` or an endpoint-fetch / query-execution error. Tests drive
 * the outcome through the `respond` constructor so the probe's HTTP-success
 * vs HTTP-error vs latency-bounded paths can each be asserted without a
 * Comunica round-trip.
 */
function makeEngine(
  respond: (
    query: string,
    options?: Parameters<QueryEngine['executeResult']>[1],
  ) => ReturnType<QueryEngine['executeResult']>,
): {
  engine: ProbeEngine;
  calls: Array<{
    query: string;
    options?: Parameters<QueryEngine['executeResult']>[1];
  }>;
} {
  const calls: Array<{
    query: string;
    options?: Parameters<QueryEngine['executeResult']>[1];
  }> = [];
  const engine: ProbeEngine = {
    executeResult(query, options) {
      calls.push({ query, options });
      return respond(query, options);
    },
  };
  return { engine, calls };
}

const askBody = (boolean: boolean): ExecuteResult => ({
  body: JSON.stringify({ head: {}, boolean }),
  format: 'json',
  contentType: 'application/sparql-results+json',
});

describe('probeEndpoint — happy path (#359)', () => {
  it('returns { ok: true, latencyMs } when the engine ASK resolves', async () => {
    // The probe issues a single `ASK { ?s ?p ?o }` against the endpoint's
    // pass-through QueryEngine and reports the wall-clock cost of that one
    // call. The latencyMs is a number — exact value depends on the test
    // clock, but must be present and finite.
    const { engine, calls } = makeEngine(() => okAsync(askBody(true)));
    const result = await probeEndpoint(engine);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(typeof result.latencyMs).toBe('number');
    expect(Number.isFinite(result.latencyMs)).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    // Locks the contract: the probe issues exactly one ASK; the result is
    // never derived from a SELECT or CONSTRUCT.
    expect(calls).toHaveLength(1);
    expect(calls[0].query.trim()).toBe('ASK { ?s ?p ?o }');
  });

  it('reports ok: true even when the endpoint answers ASK with `false` — reachability is the contract, not data shape', async () => {
    // An empty endpoint answers `ASK { ?s ?p ?o }` with `{ boolean: false }`.
    // That is still a successful round-trip — the probe's verdict is
    // "could we reach the endpoint", not "does it have any data".
    const { engine } = makeEngine(() => okAsync(askBody(false)));
    const result = await probeEndpoint(engine);
    expect(result.ok).toBe(true);
  });
});

describe('probeEndpoint — error path (#359)', () => {
  it('returns { ok: false, error: { kind, message } } when the engine reports an endpoint-fetch error', async () => {
    // Comunica's underlying fetch failed (DNS, TLS, 5xx, timeout). The
    // pass-through `QueryEngine` collapses every endpoint-side throw into
    // `kind: 'endpoint-fetch'`; the probe forwards both `kind` and `message`
    // verbatim so the page chip can render the kind as a CSS class and the
    // message as the first line of inline detail (PRD user story 27).
    const { engine } = makeEngine(() =>
      errAsync({
        kind: 'endpoint-fetch' as const,
        endpoint: 'https://example.org/sparql',
        message: 'ECONNREFUSED',
      }),
    );
    const result = await probeEndpoint(engine);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected !ok');
    expect(result.error.kind).toBe('endpoint-fetch');
    expect(result.error.message).toBe('ECONNREFUSED');
  });
});

describe('probeEndpoint — latency bound to the query call (#359)', () => {
  it('latencyMs spans only the executeResult call — pre/post engine work is excluded', async () => {
    // The PRD's acceptance criterion #1 spells out: "latency is measured
    // around the query call only". The injected clock advances inside the
    // engine stub (i.e. during executeResult) and is stable outside it, so
    // the recorded latency must equal exactly the in-call delta. A naive
    // probe that times `Date.now()` at construction or after building the
    // engine would record a much larger value the moment any caller setup
    // happened upstream.
    let nowMs = 1_000;
    const advance = (by: number): void => {
      nowMs += by;
    };
    const now = (): number => nowMs;
    const { engine } = makeEngine(() => {
      advance(50);
      return okAsync(askBody(true));
    });
    // Burn 250ms of "outside the engine" time before calling — must not
    // contaminate the recorded latency.
    advance(250);
    const result = await probeEndpoint(engine, now);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.latencyMs).toBe(50);
  });

  it('records latencyMs on the error path too, bounded to the same engine-call window', async () => {
    // A failing probe still needs latency for the chip's diagnostic value —
    // a 30s timeout vs a 2ms refused connection tell different stories.
    let nowMs = 0;
    const now = (): number => nowMs;
    const { engine } = makeEngine(() => {
      nowMs += 7;
      return errAsync({
        kind: 'endpoint-fetch' as const,
        endpoint: 'https://example.org/sparql',
        message: 'timeout',
      });
    });
    const result = await probeEndpoint(engine, now);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected !ok');
    expect(result.latencyMs).toBe(7);
  });
});

describe('probeEndpoint — never memoized across calls (#359)', () => {
  it('two probes both hit the engine — the result is never cached across calls (PRD user story 20)', async () => {
    // "The result is never memoized" is the contract that lets the chip
    // never lie about a stale check. A probe that cached the first ok would
    // pretend the endpoint is up long after it went down.
    const { engine, calls } = makeEngine(() => okAsync(askBody(true)));
    await probeEndpoint(engine);
    await probeEndpoint(engine);
    expect(calls).toHaveLength(2);
  });

  it('a prior error does not stick — a later probe re-asks fresh', async () => {
    // The first call fails, the next succeeds: the second probe must
    // observe the success (the probe must not remember the first error).
    let n = 0;
    const { engine } = makeEngine(() => {
      n += 1;
      return n === 1
        ? errAsync({
            kind: 'endpoint-fetch' as const,
            endpoint: 'https://example.org/sparql',
            message: 'first call failed',
          })
        : okAsync(askBody(true));
    });
    const first = await probeEndpoint(engine);
    expect(first.ok).toBe(false);
    const second = await probeEndpoint(engine);
    expect(second.ok).toBe(true);
  });
});
