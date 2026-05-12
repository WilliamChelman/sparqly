/**
 * Minimal logging seam used at sparqly's process boundaries (HTTP requests,
 * SPARQL executions, source loads). See ADR-0020. `libs/core` stays
 * framework-agnostic by depending on this interface rather than NestJS's
 * `Logger`; the CLI and server adapt their `Logger` to it.
 */
export type SparqlyLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type SparqlyLogFields = Record<string, unknown>;

export interface SparqlyLogger {
  debug(msg: string, fields?: SparqlyLogFields): void;
  info(msg: string, fields?: SparqlyLogFields): void;
  warn(msg: string, fields?: SparqlyLogFields): void;
  error(msg: string, fields?: SparqlyLogFields): void;
}

const noop = (): void => undefined;

/** Default `SparqlyLogger` for callers that don't wire one in: emits nothing. */
export const noopLogger: SparqlyLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};
