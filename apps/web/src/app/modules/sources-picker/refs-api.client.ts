import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, of, shareReplay, tap, throwError, type Observable } from 'rxjs';

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
  head?: RefEntry;
  branches: RefEntry[];
  remoteBranches: RefEntry[];
  tags: RefEntry[];
}

export type RefsLoadResult =
  | { state: 'ok'; refs: RefsResponse }
  | { state: 'no-git-repo'; kind: string }
  | { state: 'no-git-history' };

export type RefreshResult =
  | { state: 'ok'; refs: RefsResponse }
  | { state: 'fetch-failed'; kind: string };

export interface CommitEntry {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authorDate: string;
  parents: string[];
}

export interface CommitsResponse {
  commits: CommitEntry[];
  nextBefore: string | null;
}

export type CommitsLoadResult =
  | { state: 'ok'; commits: CommitsResponse }
  | { state: 'bad-ref' }
  | { state: 'git-io' }
  | { state: 'invalid-scope' };

export interface LoadCommitsOptions {
  scope: string;
}

@Injectable()
export class RefsApiClient {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Observable<RefsLoadResult>>();
  private readonly commitsCache = new Map<
    string,
    Observable<CommitsLoadResult>
  >();

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
            typeof err.error === 'object'
          ) {
            const body = err.error as { error?: unknown; kind?: unknown };
            if (body.error === 'no-git-repo') {
              return of<RefsLoadResult>({
                state: 'no-git-repo',
                kind: String(body.kind ?? ''),
              });
            }
            if (body.error === 'no-git-history') {
              return of<RefsLoadResult>({ state: 'no-git-history' });
            }
          }
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.cache.set(sourceId, stream);
    return stream;
  }

  loadCommits(
    sourceId: string,
    options: LoadCommitsOptions,
  ): Observable<CommitsLoadResult> {
    const key = `${sourceId}\x00${options.scope}`;
    const cached = this.commitsCache.get(key);
    if (cached !== undefined) return cached;
    const stream = this.http
      .get<CommitsResponse>(
        `/api/sources/${encodeURIComponent(sourceId)}/commits?ref=${encodeURIComponent(options.scope)}`,
      )
      .pipe(
        map((commits): CommitsLoadResult => ({ state: 'ok', commits })),
        catchError((err: unknown) => {
          if (
            err instanceof HttpErrorResponse &&
            err.error !== null &&
            typeof err.error === 'object'
          ) {
            const body = err.error as { error?: unknown };
            if (err.status === 404 && body.error === 'bad-ref') {
              return of<CommitsLoadResult>({ state: 'bad-ref' });
            }
            if (err.status === 404 && body.error === 'git-io') {
              return of<CommitsLoadResult>({ state: 'git-io' });
            }
            if (err.status === 400 && body.error === 'invalid-scope') {
              return of<CommitsLoadResult>({ state: 'invalid-scope' });
            }
          }
          return throwError(() => err);
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    this.commitsCache.set(key, stream);
    return stream;
  }

  clearCommitsCache(sourceId: string): void {
    const prefix = `${sourceId}\x00`;
    for (const key of [...this.commitsCache.keys()]) {
      if (key.startsWith(prefix)) this.commitsCache.delete(key);
    }
  }

  refresh(sourceId: string): Observable<RefreshResult> {
    return this.http
      .post<RefsResponse>(
        `/api/sources/${encodeURIComponent(sourceId)}/refs/fetch`,
        null,
      )
      .pipe(
        map((refs): RefreshResult => ({ state: 'ok', refs })),
        tap((result) => {
          if (result.state === 'ok') {
            this.cache.set(
              sourceId,
              of<RefsLoadResult>({ state: 'ok', refs: result.refs }).pipe(
                shareReplay({ bufferSize: 1, refCount: false }),
              ),
            );
          }
        }),
        catchError((err: unknown) => {
          if (
            err instanceof HttpErrorResponse &&
            err.status === 502 &&
            err.error !== null &&
            typeof err.error === 'object' &&
            (err.error as { error?: unknown }).error === 'fetch-failed'
          ) {
            const kind = String((err.error as { kind?: unknown }).kind ?? '');
            return of<RefreshResult>({ state: 'fetch-failed', kind });
          }
          return throwError(() => err);
        }),
      );
  }
}
