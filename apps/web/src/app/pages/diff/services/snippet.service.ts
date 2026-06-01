import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Subject, type Observable } from 'rxjs';

export interface SnippetPayload {
  kind: 'snippet';
  startLine: number;
  focalStart: number;
  focalEnd: number;
  lines: string[];
}

/**
 * Wire-format `SnippetError` variants the server surfaces in HTTP error bodies
 * (per ADR-0024 / issue #252). The webapp renderer switches on `kind` so a
 * file-read failure shows path + reason instead of crashing the page.
 */
export interface SnippetFileReadError {
  kind: 'file-read';
  file: string;
  reason: 'missing' | 'not-a-file' | 'io';
}

export interface SnippetRangeOutOfBoundsError {
  kind: 'range-out-of-bounds';
  spec: string;
}

/** Fallback for HTTP errors that did not carry a structured SnippetError body. */
export interface SnippetUnavailable {
  kind: 'unavailable';
  reason: 'missing';
}

export type SnippetReadResult =
  | SnippetPayload
  | SnippetFileReadError
  | SnippetRangeOutOfBoundsError
  | SnippetUnavailable;

/** A focal line range to fetch (1-based, inclusive). */
export interface SnippetFocalRange {
  focalStart: number;
  focalEnd: number;
}

interface BatchEntry {
  range: SnippetFocalRange;
  subject: Subject<SnippetReadResult>;
}

interface Batch {
  file: string;
  context: number;
  /** Commit SHA of the pinned side, or undefined for a working-tree read. */
  gitSha: string | undefined;
  entries: BatchEntry[];
}

function rangeParam(r: SnippetFocalRange): string {
  return r.focalStart === r.focalEnd
    ? String(r.focalStart)
    : `${r.focalStart}-${r.focalEnd}`;
}

/**
 * Fetches **source-file snippets** from `GET /api/source-snippet`.
 *
 * Calls made within the same microtask for the same (file, snippetContext)
 * are coalesced into a single request carrying one `range` param per call;
 * the response's `snippets[]` is fanned back out to each caller in order.
 * One hunk renders many snippets from the same source file, so this turns a
 * burst of per-snippet GETs into one GET per file.
 *
 * HTTP error responses carrying a structured `SnippetError` body (per
 * ADR-0024) are emitted to every pending subscriber so the snippet pane can
 * render the structured failure (e.g. `file-read` path + reason) rather than
 * crash on moved/missing files (user story 7 / #252).
 */
@Injectable({ providedIn: 'root' })
export class SnippetService {
  private readonly http = inject(HttpClient);
  private readonly pending = new Map<string, Batch>();

  fetch(
    file: string,
    range: SnippetFocalRange,
    context: number,
    gitSha?: string,
  ): Observable<SnippetReadResult> {
    // gitSha is part of the key: a pinned left and right share the same `file`
    // but different blobs, so they must not coalesce into one request.
    const key = `${context} ${gitSha ?? ''} ${file}`;
    let batch = this.pending.get(key);
    if (batch === undefined) {
      batch = { file, context, gitSha, entries: [] };
      this.pending.set(key, batch);
      queueMicrotask(() => this.flush(key));
    }
    const subject = new Subject<SnippetReadResult>();
    batch.entries.push({ range, subject });
    return subject.asObservable();
  }

  private flush(key: string): void {
    const batch = this.pending.get(key);
    if (batch === undefined) return;
    this.pending.delete(key);

    let params = new HttpParams()
      .set('file', batch.file)
      .set('snippetContext', String(batch.context));
    if (batch.gitSha !== undefined) {
      params = params.set('gitSha', batch.gitSha);
    }
    for (const { range } of batch.entries) {
      params = params.append('range', rangeParam(range));
    }

    this.http
      .get<{ snippets: SnippetPayload[] }>('/api/source-snippet', { params })
      .subscribe({
        next: ({ snippets }) =>
          batch.entries.forEach(({ subject }, i) =>
            settle(subject, snippets[i] ?? { kind: 'unavailable', reason: 'missing' }),
          ),
        error: (err: HttpErrorResponse) => {
          const fanout = structuredOrFallback(err);
          batch.entries.forEach(({ subject }) => settle(subject, fanout));
        },
      });
  }
}

function structuredOrFallback(err: HttpErrorResponse): SnippetReadResult {
  const body = err.error;
  if (isFileReadError(body)) {
    return { kind: 'file-read', file: body.file, reason: body.reason };
  }
  if (isRangeOutOfBoundsError(body)) {
    return { kind: 'range-out-of-bounds', spec: body.spec };
  }
  return { kind: 'unavailable', reason: 'missing' };
}

function isFileReadError(body: unknown): body is SnippetFileReadError {
  if (typeof body !== 'object' || body === null) return false;
  const o = body as Record<string, unknown>;
  return (
    o['kind'] === 'file-read' &&
    typeof o['file'] === 'string' &&
    (o['reason'] === 'missing' || o['reason'] === 'not-a-file' || o['reason'] === 'io')
  );
}

function isRangeOutOfBoundsError(body: unknown): body is SnippetRangeOutOfBoundsError {
  if (typeof body !== 'object' || body === null) return false;
  const o = body as Record<string, unknown>;
  return o['kind'] === 'range-out-of-bounds' && typeof o['spec'] === 'string';
}

function settle(
  subject: Subject<SnippetReadResult>,
  result: SnippetReadResult,
): void {
  subject.next(result);
  subject.complete();
}
