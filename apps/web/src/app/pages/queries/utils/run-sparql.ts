import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { catchError, map, of, type Observable } from 'rxjs';
import { decodeSparqlResult, detectQueryType } from '@app/core';
import { parseErrorBody } from '../../query/utils/parse-error-body';
import { acceptForQueryType } from '../../query/utils/sparql-defaults';
import type { ResultPaneState } from '../../query/components/result/result-pane.component';

export function runSparql(
  http: HttpClient,
  sourceId: string,
  sparql: string,
): Observable<ResultPaneState> {
  const url = `/api/sparql/${encodeURIComponent(sourceId)}`;
  const accept = acceptForQueryType(detectQueryType(sparql));
  const headers: Record<string, string> = {
    'Content-Type': 'application/sparql-query',
  };
  if (accept) headers['Accept'] = accept;
  return http
    .post(url, sparql, {
      headers: new HttpHeaders(headers),
      observe: 'response',
      responseType: 'text',
    })
    .pipe(
      map((response): ResultPaneState => {
        const contentType =
          response.headers.get('Content-Type') ?? 'application/octet-stream';
        const body = response.body ?? '';
        return {
          kind: 'result',
          result: decodeSparqlResult(body, contentType),
        };
      }),
      catchError((e: HttpErrorResponse) => {
        const errBody = parseErrorBody(e?.error);
        const message = errBody ?? e?.message ?? 'request failed';
        return of<ResultPaneState>({ kind: 'error', message });
      }),
    );
}
