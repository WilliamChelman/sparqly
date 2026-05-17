import {
  HttpClient,
  HttpErrorResponse,
  HttpHeaders,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

export interface SavedQuerySummary {
  slug: string;
  description?: string;
  hasParameters: boolean;
}

export interface SavedQueryEntry {
  slug: string;
  description?: string;
  body: string;
}

export interface LoadedSavedQuery {
  entry: SavedQueryEntry;
  etag: string;
}

export interface SavedQueryWriteBody {
  body: string;
  description?: string;
}

export type PutResult =
  | { kind: 'saved'; etag: string }
  | { kind: 'stale' }
  | { kind: 'slug-exists' };

export type DeleteResult = { kind: 'deleted' } | { kind: 'stale' };

function unquoteEtag(header: string | null): string {
  if (!header) return '';
  const trimmed = header.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

@Injectable({ providedIn: 'root' })
export class SavedQueriesService {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly SavedQuerySummary[]> {
    return this.http.get<readonly SavedQuerySummary[]>('/api/saved-queries');
  }

  get(slug: string): Observable<LoadedSavedQuery> {
    return this.http
      .get<SavedQueryEntry>(`/api/saved-queries/${encodeURIComponent(slug)}`, {
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          entry: response.body as SavedQueryEntry,
          etag: unquoteEtag(response.headers.get('ETag')),
        })),
      );
  }

  put(
    slug: string,
    body: SavedQueryWriteBody,
    ifMatch?: string,
  ): Observable<PutResult> {
    const headers: Record<string, string> = {};
    if (ifMatch !== undefined) headers['If-Match'] = `"${ifMatch}"`;
    return this.http
      .put<SavedQueryEntry>(
        `/api/saved-queries/${encodeURIComponent(slug)}`,
        body,
        { headers: new HttpHeaders(headers), observe: 'response' },
      )
      .pipe(
        map(
          (response): PutResult => ({
            kind: 'saved',
            etag: unquoteEtag(response.headers.get('ETag')),
          }),
        ),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 412) return of<PutResult>({ kind: 'stale' });
          if (err.status === 409) return of<PutResult>({ kind: 'slug-exists' });
          return throwError(() => err);
        }),
      );
  }

  delete(slug: string, ifMatch: string): Observable<DeleteResult> {
    return this.http
      .delete(`/api/saved-queries/${encodeURIComponent(slug)}`, {
        headers: new HttpHeaders({ 'If-Match': `"${ifMatch}"` }),
      })
      .pipe(
        map((): DeleteResult => ({ kind: 'deleted' })),
        catchError((err: HttpErrorResponse) => {
          if (err.status === 412) return of<DeleteResult>({ kind: 'stale' });
          return throwError(() => err);
        }),
      );
  }
}
