import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { PathStep } from 'common';
import type { Observable } from 'rxjs';

export interface DescribeRequest {
  iri: string;
  /**
   * The source to describe against (ADR-0052). Omit to let the server resolve
   * the registry's default source; set to an `@`-prefixed (or bare) id to
   * describe against exactly that source.
   */
  source?: string;
  /**
   * UI-driven blank-node expansion paths against the selected endpoint
   * `source` (ADR-0019, ADR-0052). The server rejects this field unless
   * `source` is set to an `endpoint` kind.
   */
  expandedPaths?: PathStep[][];
}

export interface DescribeResponse {
  iri: string;
  quads: string;
  total: number;
  /** The (single) source's description was capped or has dangling bnodes. */
  truncated: boolean;
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
