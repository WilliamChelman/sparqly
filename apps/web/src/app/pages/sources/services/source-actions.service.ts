import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export type ProbeResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      latencyMs: number;
      error: { kind: string; message: string };
    };

@Injectable({ providedIn: 'root' })
export class SourceActionsService {
  private readonly http = inject(HttpClient);

  load(id: string): Observable<unknown> {
    return this.postVerb(id, 'load');
  }

  reload(id: string): Observable<unknown> {
    return this.postVerb(id, 'reload');
  }

  unload(id: string): Observable<unknown> {
    return this.postVerb(id, 'unload');
  }

  rebuildIndex(id: string): Observable<unknown> {
    return this.http.post(
      `/api/sources/${encodeURIComponent(id)}/index-build`,
      null,
    );
  }

  cancelBuild(id: string): Observable<unknown> {
    return this.http.delete(
      `/api/sources/${encodeURIComponent(id)}/index-build`,
    );
  }

  testConnection(id: string): Observable<ProbeResult> {
    return this.http.post<ProbeResult>(
      `/api/sources/${encodeURIComponent(id)}/test-connection`,
      null,
    );
  }

  private postVerb(
    id: string,
    verb: 'load' | 'reload' | 'unload',
  ): Observable<unknown> {
    return this.http.post(
      `/api/sources/${encodeURIComponent(id)}/${verb}`,
      null,
    );
  }
}
