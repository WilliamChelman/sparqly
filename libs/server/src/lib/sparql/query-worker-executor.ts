import { ResultAsync } from 'neverthrow';
import type {
  EndpointFetchError,
  ExecuteOptions,
  ExecuteResult,
  QueryExecutionError,
  QueryExecutor,
} from 'core';
import type { QueryWorkerPool } from './query-worker-pool';

/**
 * Main-thread handle to a source whose store lives in the query worker
 * (ADR-0050). Implements the same {@link QueryExecutor} surface as the
 * in-process `QueryEngine`, so `EngineMap.ensure` can hand it to the thin
 * controller unchanged — every `executeResult` becomes a `query` RPC that runs
 * the CPU-bound Comunica work off the main event loop.
 */
export class WorkerQueryExecutor implements QueryExecutor {
  constructor(
    private readonly pool: QueryWorkerPool,
    private readonly sourceId: string,
  ) {}

  executeResult(
    query: string,
    options: ExecuteOptions = {},
  ): ResultAsync<ExecuteResult, QueryExecutionError | EndpointFetchError> {
    return this.pool.query(this.sourceId, query, {
      format: options.format,
      mutable: options.mutable,
      signal: options.signal,
    });
  }

  // Throwing variant for parity with `QueryEngine`; the controller uses
  // `executeResult`, so this is only here to satisfy the interface.
  async execute(
    query: string,
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const result = await this.executeResult(query, options);
    return result.match(
      (ok) => ok,
      (error) => {
        throw new Error(error.message);
      },
    );
  }
}
