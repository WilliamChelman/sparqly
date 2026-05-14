import { HttpStatus } from '@nestjs/common';
import type { SourceError } from 'core';

/**
 * Per-variant status mapping for the cross-feature `SourceError` union.
 * Allowed in `libs/server/shared/` because `SourceError` is owned by
 * `libs/core` (ADR-0024): this is a reusable sub-mapper consumed by
 * per-feature HTTP mapper modules, not a global Nest exception filter.
 *
 *   reference-target  500  config invariant — `reference` entries cannot be data
 *   glob-load         500  file/glob load failure (treated as server-side filesystem fault)
 *   query-execution   502  SPARQL execution against a materialized store failed
 *   endpoint-fetch    502  remote SPARQL endpoint network/non-2xx
 *   view-validation   400  view query validation (user-input)
 *   view-reference    400  `from:` ref unknown/cycle/reference-upstream (user-input)
 *   cache-io          500  view cache read/write/parse (server-side)
 *   transform-parse   400  invalid transform spec (user-input)
 */
export function sourceErrorToStatus(error: SourceError): HttpStatus {
  switch (error.kind) {
    case 'reference-target':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    case 'glob-load':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    case 'query-execution':
      return HttpStatus.BAD_GATEWAY;
    case 'endpoint-fetch':
      return HttpStatus.BAD_GATEWAY;
    case 'view-validation':
      return HttpStatus.BAD_REQUEST;
    case 'view-reference':
      return HttpStatus.BAD_REQUEST;
    case 'cache-io':
      return HttpStatus.INTERNAL_SERVER_ERROR;
    case 'transform-parse':
      return HttpStatus.BAD_REQUEST;
  }
}
