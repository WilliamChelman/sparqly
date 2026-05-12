import {
  outcomeFields,
  truncateQueryText,
  type SparqlyLogFields,
  type SparqlyLogger,
} from 'common';
import type { QueryType } from '../canonical/immutability';

/** Resolution mode label for the SPARQL-execution log event (ADR-0020). */
export type QueryResolutionMode = 'materialized' | 'pass-through' | 'view';

/**
 * Result-size facet of the `query` event: `rows` for SELECT, `quads` for
 * CONSTRUCT/DESCRIBE (or a view that produced triples), `boolean` for ASK.
 */
export type QueryResultSize =
  | { rows: number }
  | { quads: number }
  | { boolean: boolean | undefined };

export interface QueryLogEvent {
  /** Source `@id` (or endpoint URL, or view id). Omitted when unknown. */
  source?: string;
  mode?: QueryResolutionMode;
  query: string;
  type: QueryType;
  ms: number;
  size?: QueryResultSize;
  bytes?: number;
  /** When present, the execution failed; recorded via `outcome`/`error`. */
  err?: unknown;
}

/**
 * Emit the single `query` debug event every SPARQL-executing entry point shares
 * (ADR-0020). A `undefined` or no-op logger emits nothing; field order matches
 * the engine's so text/JSON output is identical regardless of call site.
 */
export function emitQueryEvent(
  logger: SparqlyLogger | undefined,
  event: QueryLogEvent,
): void {
  if (!logger) return;
  const fields: SparqlyLogFields = {};
  if (event.source !== undefined) fields['source'] = event.source;
  if (event.mode !== undefined) fields['mode'] = event.mode;
  fields['type'] = event.type;
  fields['ms'] = event.ms;
  if (event.size) {
    if ('rows' in event.size) fields['rows'] = event.size.rows;
    else if ('quads' in event.size) fields['quads'] = event.size.quads;
    else fields['boolean'] = event.size.boolean;
  }
  if (event.bytes !== undefined) fields['bytes'] = event.bytes;
  fields['query'] = truncateQueryText(event.query);
  if (event.err !== undefined) Object.assign(fields, outcomeFields(event.err));
  logger.debug('query', fields);
}
