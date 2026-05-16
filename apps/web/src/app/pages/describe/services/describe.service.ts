import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { PathStep } from 'common';
import type { Observable } from 'rxjs';

export interface DescribeRequest {
  iri: string;
  /**
   * Single-or-all source selection (ADR-0033). Omit for the merged-across-all
   * "absorbed registry" view; set to an `@`-prefixed (or bare) id to describe
   * against exactly that source.
   */
  source?: string;
  /**
   * UI-driven blank-node expansion paths against the selected endpoint
   * `source` (ADR-0019, ADR-0033). The server rejects this field unless
   * `source` is set to an `endpoint` kind.
   */
  expandedPaths?: PathStep[][];
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
    if (req.source !== undefined) body.source = req.source;
    if (req.expandedPaths !== undefined) body.expandedPaths = req.expandedPaths;
    return this.http.post<DescribeResponse>('/api/describe', body);
  }
}
