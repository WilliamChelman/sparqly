import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, of, type Observable } from 'rxjs';
import { parseErrorBody } from '../utils/parse-error-body';
import { detectQueryType } from '../utils/query-detection';
import {
  decodeSparqlResult,
  type DecodedResult,
} from '../utils/sparql-result-decoder';

/** The `X-Sparqly-Cache` disposition `serve` stamps on a response (ADR-0054). */
export type CacheStatus = 'hit' | 'miss' | 'bypass';

/**
 * What a run resolves to — never an HTTP error: failures are folded into the
 * `error` variant with a human-readable message.
 */
export type SparqlRunOutcome =
  | { kind: 'result'; result: DecodedResult; cacheStatus?: CacheStatus }
  | { kind: 'error'; message: string };

export interface SparqlRunOptions {
  /**
   * Force refresh (ADR-0054, #418): recompute a cached result. Sent as the
   * standard `Cache-Control: no-cache` request directive, which `serve` maps
   * to the Query cache's `refresh` — execute and replace the stored entry.
   */
  refresh?: boolean;
}

/**
 * The webapp's one door to the SPARQL protocol surface of `serve`. The
 * intricacies — endpoint URL shape, Accept negotiation from the query type,
 * the refresh directive, the `X-Sparqly-Cache` disposition, error-body
 * parsing — live behind it; components see only a source id, a query, and a
 * decoded {@link SparqlRunOutcome}.
 */
@Injectable({ providedIn: 'root' })
export class SparqlClientService {
  private readonly http = inject(HttpClient);

  run(
    sourceId: string,
    sparql: string,
    options: SparqlRunOptions = {},
  ): Observable<SparqlRunOutcome> {
    const url = `/api/sparql/${encodeURIComponent(sourceId)}`;
    const accept = acceptForQueryType(detectQueryType(sparql));
    const headers: Record<string, string> = {
      'Content-Type': 'application/sparql-query',
    };
    if (accept) headers['Accept'] = accept;
    if (options.refresh) headers['Cache-Control'] = 'no-cache';
    return this.http
      .post(url, sparql, {
        headers: new HttpHeaders(headers),
        observe: 'response',
        responseType: 'text',
      })
      .pipe(
        map((response): SparqlRunOutcome => {
          const contentType =
            response.headers.get('Content-Type') ?? 'application/octet-stream';
          return {
            kind: 'result',
            result: decodeSparqlResult(response.body ?? '', contentType),
            cacheStatus: parseCacheStatus(
              response.headers.get('X-Sparqly-Cache'),
            ),
          };
        }),
        catchError((e: HttpErrorResponse) =>
          of<SparqlRunOutcome>({
            kind: 'error',
            message: parseErrorBody(e?.error) ?? e?.message ?? 'request failed',
          }),
        ),
      );
  }
}

/** SPARQL protocol content negotiation: the Accept header a query type wants. */
function acceptForQueryType(
  queryType: string | undefined,
): string | undefined {
  switch (queryType) {
    case 'SELECT':
    case 'ASK':
      return 'application/sparql-results+json';
    case 'CONSTRUCT':
    case 'DESCRIBE':
      return 'text/turtle';
    default:
      return undefined;
  }
}

/** An absent or unrecognised header leaves the outcome untagged. */
function parseCacheStatus(value: string | null): CacheStatus | undefined {
  return value === 'hit' || value === 'miss' || value === 'bypass'
    ? value
    : undefined;
}
