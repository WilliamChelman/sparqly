import type { ResultAsync } from 'neverthrow';
import type {
  EndpointFetchError,
  ExecuteResult,
  QueryExecutionError,
} from 'core';

export interface ProbeEngine {
  executeResult(
    query: string,
    options?: { format?: 'json' | 'turtle'; mutable?: boolean },
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError>;
}

export type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: { kind: string; message: string }; latencyMs: number };

const PROBE_QUERY = 'ASK { ?s ?p ?o }';

/**
 * Runs one `ASK` against the endpoint and reports the verdict. Never memoized;
 * `now` is injectable so latency assertions don't race the wall clock.
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
  const error = result.error;
  return {
    ok: false,
    error: { kind: error.kind, message: error.message },
    latencyMs,
  };
}
