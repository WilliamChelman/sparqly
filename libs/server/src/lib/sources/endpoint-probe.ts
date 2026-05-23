import type { ResultAsync } from 'neverthrow';
import type {
  EndpointFetchError,
  ExecuteResult,
  QueryExecutionError,
} from 'core';

/**
 * Structural slice of `QueryEngine` the probe needs — just enough to issue
 * one `ASK` and observe its `Result`. Narrowing the dep to a one-method shape
 * keeps the probe trivially testable (no Comunica setup, no endpoint URL
 * juggling) and lets callers feed it whatever engine instance the
 * `EngineMap`'s pass-through `LoadedEntry` already constructed at boot.
 */
export interface ProbeEngine {
  executeResult(
    query: string,
    options?: { format?: 'json' | 'turtle'; mutable?: boolean },
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError>;
}

/**
 * Outcome of a single **Test connection** click on an **Endpoint source** row
 * of the Sources page (#359, parent #352). The shape mirrors the click — one
 * round-trip, one verdict — and is **never memoized**: each call issues a
 * fresh `ASK`, so the chip never lies about a stale check. `latencyMs` is the
 * wall-clock cost of the ASK call only — engine setup, request marshalling,
 * and the surrounding HTTP turn are excluded.
 */
export type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: { kind: string; message: string }; latencyMs: number };

/**
 * The one canonical query the **Test connection** probe issues. Decided in the
 * PRD's user story 20: a single `ASK { ?s ?p ?o }` against the endpoint —
 * reachability is the contract, not data shape, so an endpoint that answers
 * `boolean: false` still counts as reachable.
 */
const PROBE_QUERY = 'ASK { ?s ?p ?o }';

/**
 * Runs one `ASK { ?s ?p ?o }` against the endpoint's pass-through
 * `QueryEngine` and reports `{ ok, latencyMs, error? }` for that single
 * click. Never memoized — each invocation re-asks (PRD user story 20). The
 * `now` injection lets tests pin the clock so the latency-bound assertion
 * doesn't race a real wall clock; production callers omit it and get
 * `Date.now()`.
 */
export async function probeEndpoint(
  engine: ProbeEngine,
  now: () => number = Date.now,
): Promise<ProbeResult> {
  const started = now();
  const result = await engine.executeResult(PROBE_QUERY, { format: 'json' });
  const latencyMs = now() - started;
  if (result.isOk()) {
    return { ok: true, latencyMs };
  }
  // Endpoint-fetch and query-execution errors travel the same probe channel —
  // the operator wants to see "endpoint unreachable" either way. Both carry
  // a `kind` discriminator and a `message`; the probe forwards both verbatim
  // so the page chip can render the kind as a class and the message as the
  // first line of detail (PRD user story 27 → #359 row chip).
  const error = result.error;
  return {
    ok: false,
    error: { kind: error.kind, message: error.message },
    latencyMs,
  };
}
