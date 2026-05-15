import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, of, shareReplay, throwError, type Observable } from 'rxjs';

export type RefKind =
  | 'head'
  | 'branch'
  | 'remote-branch'
  | 'remote-head'
  | 'tag-annotated'
  | 'tag-lightweight';

export interface RefEntry {
  ref: string;
  sha: string;
  kind: RefKind;
  remote?: string;
}

export interface RefsResponse {
  head: RefEntry;
  branches: RefEntry[];
  remoteBranches: RefEntry[];
  tags: RefEntry[];
}

export type RefsLoadResult =
  | { state: 'ok'; refs: RefsResponse }
  | { state: 'no-git-repo'; kind: string };

@Injectable()
export class RefsApiClient {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<RefsLoadResult>>();

  load(sourceId: string): Observable<RefsLoadResult> {
    const cached = this.cache.get(sourceId);
    if (cached !== undefined) return cached;
    const stream = this.http
      .get<RefsResponse>(`/api/sources/${encodeURIComponent(sourceId)}/refs`)
      .pipe(
        map((refs): RefsLoadResult => ({ state: 'ok', refs })),
        catchError((err: unknown) => {
          if (
            err instanceof HttpErrorResponse &&
            err.status === 404 &&
            err.error !== null &&
            typeof err.error === 'object' &&
            (err.error as { error?: unknown }).error === 'no-git-repo'
          ) {
            const kind = String((err.error as { kind?: unknown }).kind ?? '');
            return of<RefsLoadResult>({ state: 'no-git-repo', kind });
          }
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.cache.set(sourceId, stream);
    return stream;
  }
}
