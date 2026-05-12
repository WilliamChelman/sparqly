import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { PathStep } from 'common';
import type { Observable } from 'rxjs';

export interface DescribeRequest {
  iri: string;
  sources?: string[];
  /** UI-driven blank-node expansion paths per source id (ADR-0019). */
  expandedPaths?: Record<string, PathStep[][]>;
}

export interface DescribePerSourceEntry {
  count: number;
  truncated: boolean;
  /** Present when this source's describe run failed. The request still
   * succeeds (HTTP 200) as long as another source contributed quads. */
  error?: string;
}

export interface DescribeResponse {
  iri: string;
  quads: string;
  total: number;
  perSource: Record<string, DescribePerSourceEntry>;
}

@Injectable({ providedIn: 'root' })
export class DescribeService {
  private readonly http = inject(HttpClient);

  run(req: DescribeRequest): Observable<DescribeResponse> {
    const body: DescribeRequest = { iri: req.iri };
    if (req.sources !== undefined) body.sources = [...req.sources];
    if (req.expandedPaths !== undefined) body.expandedPaths = req.expandedPaths;
    return this.http.post<DescribeResponse>('/api/describe', body);
  }
}
